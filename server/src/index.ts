import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import {
  loadSettings,
  maskApiKey,
  PROJECT_ROOT,
  saveSettings,
  THUMBS_DIR,
  UPLOADS_DIR,
} from './config.js';
import { db, deleteFolderFromDb, FolderRow, MediaRow } from './db.js';
import { browseDirectory } from './fsBrowser.js';
import {
  analyzeMediaItem,
  indexingState,
  pauseIndexing,
  startIndexingQueue,
  testGeminiConnection,
} from './gemini.js';
import { scanProgress } from './scanner.js';
import { findSimilarMedia, semanticSearch } from './search.js';
import {
  autoOrganizeFolder,
  buildSortPlan,
  executeSortPlan,
  SortPreset,
  undoSortOperation,
} from './sorter.js';
import {
  initAllWatchers,
  runFolderPipeline,
  startWatcherForFolder,
  stopWatcherForFolder,
} from './watcher.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/thumbs', express.static(THUMBS_DIR));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const batchName = String(req.body?.batchName || 'Browser_Import').replace(
          /[^a-zA-Z0-9_-]/g,
          '_'
        );
        const dest = path.join(UPLOADS_DIR, batchName);
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (_req, file, cb) => {
        cb(null, file.originalname);
      },
    }),
  });

  function formatMediaResponse(row: MediaRow, extra?: { score?: number; matchReason?: string }) {
    let tags: string[] = [];
    let objects: string[] = [];
    let keyframes: string[] = [];
    try {
      tags = JSON.parse(row.ai_tags_json || '[]');
    } catch {
      tags = [];
    }
    try {
      objects = JSON.parse(row.ai_objects_json || '[]');
    } catch {
      objects = [];
    }
    try {
      keyframes = JSON.parse(row.keyframes_json || '[]');
    } catch {
      keyframes = [];
    }

    return {
      id: row.id,
      folderId: row.folder_id,
      path: row.path,
      filename: row.filename,
      ext: row.ext,
      mediaType: row.media_type,
      sizeBytes: row.size_bytes,
      hash: row.hash,
      width: row.width,
      height: row.height,
      durationSec: row.duration_sec,
      capturedAt: row.captured_at,
      year: row.year,
      month: row.month,
      cameraMake: row.camera_make,
      cameraModel: row.camera_model,
      gpsLat: row.gps_lat,
      gpsLng: row.gps_lng,
      thumbUrl: row.thumb_path ? `/api/thumbs/${row.thumb_path}` : null,
      keyframeUrls: keyframes.map((k) => `/api/thumbs/${k}`),
      fileUrl: `/api/media/${row.id}/file`,
      aiStatus: row.ai_status,
      aiError: row.ai_error,
      aiCaption: row.ai_caption,
      aiTags: tags,
      aiCategory: row.ai_category,
      aiObjects: objects,
      aiPeoplePets: row.ai_people_pets,
      aiMood: row.ai_mood,
      aiTextOcr: row.ai_text_ocr,
      favorite: Boolean(row.favorite),
      score: extra?.score,
      matchReason: extra?.matchReason,
    };
  }

  // ---------- Health & Stats ----------
  app.get('/api/status', (_req, res) => {
    const counts = db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN media_type = 'photo' THEN 1 ELSE 0 END) as photos,
          SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as videos,
          SUM(CASE WHEN ai_status = 'indexed' THEN 1 ELSE 0 END) as indexed,
          SUM(CASE WHEN ai_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN ai_status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(CASE WHEN favorite = 1 THEN 1 ELSE 0 END) as favorites
         FROM media`
      )
      .get() as Record<string, number | null>;

    const dupRows = db
      .prepare(
        `SELECT COUNT(*) as dupGroups FROM (
          SELECT hash FROM media WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1
        )`
      )
      .get() as { dupGroups: number };

    const categories = db
      .prepare(
        `SELECT COALESCE(ai_category, 'Uncategorized') as category, COUNT(*) as count
         FROM media
         GROUP BY COALESCE(ai_category, 'Uncategorized')
         ORDER BY count DESC`
      )
      .all() as Array<{ category: string; count: number }>;

    const timeline = db
      .prepare(
        `SELECT year, month, COUNT(*) as count
         FROM media
         GROUP BY year, month
         ORDER BY year DESC, month DESC`
      )
      .all() as Array<{ year: number; month: number; count: number }>;

    res.json({
      counts: {
        total: counts.total || 0,
        photos: counts.photos || 0,
        videos: counts.videos || 0,
        indexed: counts.indexed || 0,
        pending: counts.pending || 0,
        errors: counts.errors || 0,
        favorites: counts.favorites || 0,
        duplicateGroups: dupRows.dupGroups || 0,
      },
      categories,
      timeline,
      scanProgress,
      indexingState,
      hasApiKey: Boolean(loadSettings().apiKey),
    });
  });

  // ---------- Folder Browser & Folder Management ----------
  app.get('/api/fs/browse', (req, res) => {
    try {
      const requested = typeof req.query.path === 'string' ? req.query.path : undefined;
      res.json(browseDirectory(requested));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/folders', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT f.*, COUNT(m.id) as item_count,
          SUM(CASE WHEN m.ai_status = 'indexed' THEN 1 ELSE 0 END) as indexed_count
         FROM folders f
         LEFT JOIN media m ON m.folder_id = f.id
         GROUP BY f.id
         ORDER BY f.added_at DESC`
      )
      .all();
    res.json({ folders: rows });
  });

  app.post('/api/folders', (req, res) => {
    try {
      const rawPath = String(req.body?.path || '').trim();
      if (!rawPath) {
        res.status(400).json({ error: 'Folder path is required.' });
        return;
      }
      const resolved = path.resolve(rawPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: `Directory does not exist: ${resolved}` });
        return;
      }

      const autoOrganize = req.body?.autoOrganize ? 1 : 0;
      const organizePreset = String(req.body?.organizePreset || 'media-type');
      const organizeTarget = req.body?.organizeTarget
        ? path.resolve(String(req.body.organizeTarget))
        : null;
      const watchEnabled = req.body?.watchEnabled || autoOrganize ? 1 : 0;

      const existing = db.prepare('SELECT * FROM folders WHERE path = ?').get(resolved) as unknown as
        | FolderRow
        | undefined;

      let folderId: number;
      if (existing) {
        folderId = existing.id;
        db.prepare(
          `UPDATE folders SET auto_organize = ?, organize_preset = ?, organize_target = ?, watch_enabled = ? WHERE id = ?`
        ).run(autoOrganize, organizePreset, organizeTarget, watchEnabled, folderId);
      } else {
        const result = db
          .prepare(
            `INSERT INTO folders (path, name, added_at, status, auto_organize, organize_preset, organize_target, watch_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            resolved,
            path.basename(resolved) || resolved,
            new Date().toISOString(),
            'idle',
            autoOrganize,
            organizePreset,
            organizeTarget,
            watchEnabled
          );
        folderId = Number(result.lastInsertRowid);
      }

      const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as unknown as FolderRow;
      startWatcherForFolder(folder);
      void runFolderPipeline(folderId).catch((err) => console.error('Pipeline error:', err));

      res.json({ folder });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/folders/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as
      | FolderRow
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const autoOrganize =
      typeof req.body?.autoOrganize === 'boolean'
        ? req.body.autoOrganize
          ? 1
          : 0
        : existing.auto_organize;
    const organizePreset =
      typeof req.body?.organizePreset === 'string'
        ? req.body.organizePreset
        : existing.organize_preset;
    const organizeTarget =
      req.body?.organizeTarget !== undefined
        ? req.body.organizeTarget
          ? path.resolve(String(req.body.organizeTarget))
          : null
        : existing.organize_target;
    const watchEnabled =
      typeof req.body?.watchEnabled === 'boolean'
        ? req.body.watchEnabled
          ? 1
          : 0
        : autoOrganize
          ? 1
          : existing.watch_enabled;

    db.prepare(
      `UPDATE folders SET auto_organize = ?, organize_preset = ?, organize_target = ?, watch_enabled = ? WHERE id = ?`
    ).run(autoOrganize, organizePreset, organizeTarget, watchEnabled, id);

    const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as FolderRow;
    startWatcherForFolder(updated);
    res.json({ folder: updated });
  });

  app.post('/api/folders/:id/organize', (req, res) => {
    try {
      const id = Number(req.params.id);
      const result = autoOrganizeFolder(id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/folders/:id/rescan', (req, res) => {
    const id = Number(req.params.id);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as
      | FolderRow
      | undefined;
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    void runFolderPipeline(folder.id).catch((err) => console.error('Rescan error:', err));
    res.json({ ok: true });
  });

  app.delete('/api/folders/:id', (req, res) => {
    const id = Number(req.params.id);
    stopWatcherForFolder(id);
    deleteFolderFromDb(id);
    res.json({ ok: true });
  });

  app.post('/api/folders/upload', upload.array('files', 200), (req, res) => {
    try {
      const batchName = String(req.body?.batchName || 'Browser_Import').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      const folderPath = path.join(UPLOADS_DIR, batchName);
      fs.mkdirSync(folderPath, { recursive: true });

      let existing = db.prepare('SELECT * FROM folders WHERE path = ?').get(folderPath) as
        | { id: number }
        | undefined;
      if (!existing) {
        const insert = db
          .prepare('INSERT INTO folders (path, name, added_at, status) VALUES (?, ?, ?, ?)')
          .run(folderPath, batchName, new Date().toISOString(), 'idle');
        existing = { id: Number(insert.lastInsertRowid) };
      }

      void runFolderPipeline(existing.id).catch((err) => console.error('Upload scan error:', err));
      res.json({ folderId: existing.id, folderPath });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---------- Media Gallery & Duplicates ----------
  app.get('/api/media', (req, res) => {
    const mediaType = req.query.mediaType as string | undefined;
    const folderId = req.query.folderId ? Number(req.query.folderId) : null;
    const category = req.query.category as string | undefined;
    const year = req.query.year ? Number(req.query.year) : null;
    const month = req.query.month ? Number(req.query.month) : null;
    const favoriteOnly = req.query.favorite === 'true';
    const view = req.query.view as string | undefined;
    const sortBy = (req.query.sortBy as string) || 'date_desc';
    const limit = Math.min(500, Number(req.query.limit || 200));
    const offset = Number(req.query.offset || 0);

    if (view === 'duplicates') {
      const dupHashes = db
        .prepare(
          `SELECT hash FROM media WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1`
        )
        .all() as Array<{ hash: string }>;

      if (dupHashes.length === 0) {
        res.json({ items: [], total: 0 });
        return;
      }

      const placeholders = dupHashes.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT * FROM media WHERE hash IN (${placeholders}) ORDER BY hash ASC, captured_at DESC`
        )
        .all(...dupHashes.map((d) => d.hash)) as unknown as MediaRow[];

      res.json({
        items: rows.map((r) => formatMediaResponse(r)),
        total: rows.length,
      });
      return;
    }

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (mediaType && mediaType !== 'all') {
      conditions.push('media_type = ?');
      params.push(mediaType);
    }
    if (folderId) {
      conditions.push('folder_id = ?');
      params.push(folderId);
    }
    if (category) {
      if (category === 'Uncategorized') {
        conditions.push(`(ai_category IS NULL OR ai_category = '' OR ai_category = 'Uncategorized')`);
      } else {
        conditions.push('ai_category = ?');
        params.push(category);
      }
    }
    if (year) {
      conditions.push('year = ?');
      params.push(year);
    }
    if (month) {
      conditions.push('month = ?');
      params.push(month);
    }
    if (favoriteOnly) {
      conditions.push('favorite = 1');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderSql =
      sortBy === 'date_asc'
        ? 'captured_at ASC'
        : sortBy === 'size_desc'
          ? 'size_bytes DESC'
          : sortBy === 'name_asc'
            ? 'filename ASC'
            : 'captured_at DESC';

    const totalRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM media ${whereClause}`)
      .get(...params) as { cnt: number };

    const rows = db
      .prepare(`SELECT * FROM media ${whereClause} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as MediaRow[];

    res.json({
      items: rows.map((r) => formatMediaResponse(r)),
      total: totalRow.cnt,
    });
  });

  app.get('/api/media/:id/file', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT path FROM media WHERE id = ?').get(id) as
      | { path: string }
      | undefined;
    if (!row || !fs.existsSync(row.path)) {
      res.status(404).send('File not found');
      return;
    }
    res.sendFile(path.resolve(row.path));
  });

  app.post('/api/media/:id/favorite', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT favorite FROM media WHERE id = ?').get(id) as
      | { favorite: number }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    const next = row.favorite ? 0 : 1;
    db.prepare('UPDATE media SET favorite = ? WHERE id = ?').run(next, id);
    res.json({ favorite: Boolean(next) });
  });

  app.post('/api/media/:id/reindex', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as
      | MediaRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    try {
      await analyzeMediaItem(row);
      const updated = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow;
      res.json({ item: formatMediaResponse(updated) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/media/:id/similar', (req, res) => {
    const id = Number(req.params.id);
    const hits = findSimilarMedia(id);
    res.json({
      items: hits.map((h) =>
        formatMediaResponse(h.media, { score: h.score, matchReason: h.matchReason })
      ),
    });
  });

  // ---------- Natural Language AI Search ----------
  app.post('/api/search', async (req, res) => {
    try {
      const result = await semanticSearch({
        query: String(req.body?.query || ''),
        mediaType: req.body?.mediaType || 'all',
        folderId: req.body?.folderId ? Number(req.body.folderId) : null,
        category: req.body?.category || null,
        year: req.body?.year ? Number(req.body.year) : null,
        month: req.body?.month ? Number(req.body.month) : null,
        favoriteOnly: Boolean(req.body?.favoriteOnly),
        aiVerify: req.body?.aiVerify !== false,
        limit: Number(req.body?.limit || 60),
      });

      res.json({
        items: result.hits.map((h) =>
          formatMediaResponse(h.media, { score: h.score, matchReason: h.matchReason })
        ),
        usedAiVerify: result.usedAiVerify,
        usedEmbeddings: result.usedEmbeddings,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---------- AI Indexing Controls ----------
  app.post('/api/ai/index/start', (req, res) => {
    const includeErrors = Boolean(req.body?.includeErrors);
    void startIndexingQueue(includeErrors);
    res.json({ ok: true, indexingState });
  });

  app.post('/api/ai/index/pause', (_req, res) => {
    pauseIndexing();
    res.json({ ok: true, indexingState });
  });

  // ---------- Sort & Organize Studio ----------
  app.post('/api/sort/plan', (req, res) => {
    try {
      const preset = (req.body?.preset || 'media-type') as SortPreset;
      const targetRoot = String(req.body?.targetRoot || '').trim();
      if (!targetRoot) {
        res.status(400).json({ error: 'Target folder path is required.' });
        return;
      }
      const plan = buildSortPlan({
        preset,
        targetRoot,
        folderId: req.body?.folderId ? Number(req.body.folderId) : null,
        mediaIds: Array.isArray(req.body?.mediaIds) ? req.body.mediaIds : undefined,
      });
      res.json(plan);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/sort/execute', (req, res) => {
    try {
      const preset = (req.body?.preset || 'media-type') as SortPreset;
      const mode = req.body?.mode === 'move' ? 'move' : 'copy';
      const targetRoot = String(req.body?.targetRoot || '').trim();
      if (!targetRoot) {
        res.status(400).json({ error: 'Target folder path is required.' });
        return;
      }
      const result = executeSortPlan({
        preset,
        targetRoot,
        mode,
        folderId: req.body?.folderId ? Number(req.body.folderId) : null,
        mediaIds: Array.isArray(req.body?.mediaIds) ? req.body.mediaIds : undefined,
        cleanupEmptyDirs: Boolean(req.body?.cleanupEmptyDirs),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/sort/history', (_req, res) => {
    const rows = db
      .prepare(
        'SELECT id, created_at, mode, preset, target_root, moves_json, reverted FROM sort_operations ORDER BY created_at DESC LIMIT 20'
      )
      .all() as Array<{
      id: string;
      created_at: string;
      mode: string;
      preset: string;
      target_root: string;
      moves_json: string;
      reverted: number;
    }>;

    res.json({
      history: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        mode: r.mode,
        preset: r.preset,
        targetRoot: r.target_root,
        fileCount: (JSON.parse(r.moves_json || '[]') as unknown[]).length,
        reverted: Boolean(r.reverted),
      })),
    });
  });

  app.post('/api/sort/undo/:id', (req, res) => {
    try {
      const result = undoSortOperation(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---------- Settings & Gemini Connection Test ----------
  app.get('/api/settings', (_req, res) => {
    const s = loadSettings();
    res.json({
      maskedApiKey: maskApiKey(s.apiKey),
      hasApiKey: Boolean(s.apiKey),
      apiMode: s.apiMode,
      visionModel: s.visionModel,
      embeddingModel: s.embeddingModel,
      concurrency: s.concurrency,
      autoIndexOnScan: s.autoIndexOnScan,
      defaultSortMode: s.defaultSortMode,
      resolvedEndpointMode: indexingState.resolvedEndpointMode,
    });
  });

  app.post('/api/settings', (req, res) => {
    const partial: Record<string, unknown> = {};
    if (typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()) {
      partial.apiKey = req.body.apiKey.trim();
      indexingState.resolvedEndpointMode = null;
    }
    if (req.body?.apiMode) partial.apiMode = req.body.apiMode;
    if (req.body?.visionModel) partial.visionModel = req.body.visionModel;
    if (req.body?.embeddingModel) partial.embeddingModel = req.body.embeddingModel;
    if (typeof req.body?.concurrency === 'number') partial.concurrency = req.body.concurrency;
    if (typeof req.body?.autoIndexOnScan === 'boolean') {
      partial.autoIndexOnScan = req.body.autoIndexOnScan;
    }
    if (req.body?.defaultSortMode) partial.defaultSortMode = req.body.defaultSortMode;

    const updated = saveSettings(partial);
    res.json({
      maskedApiKey: maskApiKey(updated.apiKey),
      hasApiKey: Boolean(updated.apiKey),
      apiMode: updated.apiMode,
      visionModel: updated.visionModel,
      embeddingModel: updated.embeddingModel,
      concurrency: updated.concurrency,
      autoIndexOnScan: updated.autoIndexOnScan,
      defaultSortMode: updated.defaultSortMode,
    });
  });

  app.post('/api/settings/test', async (req, res) => {
    const override =
      typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()
        ? { apiKey: req.body.apiKey.trim(), apiMode: req.body?.apiMode || 'auto' }
        : { apiMode: req.body?.apiMode || loadSettings().apiMode };
    const result = await testGeminiConnection(override);
    res.json(result);
  });

  const clientDist =
    process.env.LUMINA_CLIENT_DIST || path.join(PROJECT_ROOT, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

export function startServer(port = Number(process.env.PORT || 4310)): Promise<{
  server: Server;
  port: number;
}> {
  initAllWatchers();
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`Lumina Photo Vault server running at http://127.0.0.1:${actualPort}`);
      resolve({ server, port: actualPort });
    });
  });
}

if (process.env.LUMINA_EMBEDDED !== '1') {
  void startServer();
}
