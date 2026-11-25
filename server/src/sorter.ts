import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, FolderRow, MediaRow, syncMediaFts } from './db.js';

export type SortPreset =
  | 'media-type'
  | 'media-type-category'
  | 'year-month'
  | 'year-category'
  | 'category-year';

export interface SortPlanItem {
  mediaId: number;
  filename: string;
  mediaType: 'photo' | 'video';
  fromPath: string;
  toPath: string;
  relativeTarget: string;
  category: string;
  year: number;
  month: number;
}

export interface SortPlanResult {
  preset: SortPreset;
  targetRoot: string;
  totalFiles: number;
  unchangedFiles: number;
  items: SortPlanItem[];
  folderTree: Array<{ folder: string; count: number; sampleFiles: string[] }>;
}

const MONTH_NAMES = [
  '01_January',
  '02_February',
  '03_March',
  '04_April',
  '05_May',
  '06_June',
  '07_July',
  '08_August',
  '09_September',
  '10_October',
  '11_November',
  '12_December',
];

function sanitizeSegment(segment: string): string {
  return (
    segment
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'Uncategorized'
  );
}

function buildRelativeFolder(item: MediaRow, preset: SortPreset): string {
  const yearStr = String(item.year || new Date().getFullYear());
  const monthIdx = Math.min(12, Math.max(1, item.month || 1)) - 1;
  const monthStr = MONTH_NAMES[monthIdx];
  const typeFolder = item.media_type === 'video' ? 'Videos' : 'Photos';
  const category = sanitizeSegment(item.ai_category || 'Uncategorized');

  switch (preset) {
    case 'media-type':
      return path.join(typeFolder, yearStr, monthStr);
    case 'media-type-category':
      return path.join(typeFolder, category, yearStr);
    case 'year-month':
      return path.join(yearStr, monthStr, typeFolder);
    case 'year-category':
      return path.join(yearStr, category);
    case 'category-year':
      return path.join(category, yearStr);
  }
}

function resolveCollision(destPath: string, reserved: Set<string>): string {
  if (!reserved.has(destPath) && !fs.existsSync(destPath)) {
    reserved.add(destPath);
    return destPath;
  }
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let idx = 1;
  while (true) {
    const candidate = path.join(dir, `${base} (${idx})${ext}`);
    if (!reserved.has(candidate) && !fs.existsSync(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
    idx++;
  }
}

export function buildSortPlan(options: {
  preset: SortPreset;
  targetRoot: string;
  folderId?: number | null;
  mediaIds?: number[];
}): SortPlanResult {
  const resolvedRoot = path.resolve(options.targetRoot);
  let rows: MediaRow[];

  if (options.mediaIds && options.mediaIds.length > 0) {
    const placeholders = options.mediaIds.map(() => '?').join(',');
    rows = db
      .prepare(`SELECT * FROM media WHERE id IN (${placeholders}) ORDER BY captured_at ASC`)
      .all(...options.mediaIds) as unknown as MediaRow[];
  } else if (options.folderId) {
    rows = db
      .prepare('SELECT * FROM media WHERE folder_id = ? ORDER BY captured_at ASC')
      .all(options.folderId) as unknown as MediaRow[];
  } else {
    rows = db
      .prepare('SELECT * FROM media ORDER BY captured_at ASC')
      .all() as unknown as MediaRow[];
  }

  const reserved = new Set<string>();
  const items: SortPlanItem[] = [];
  const treeMap = new Map<string, { count: number; sampleFiles: string[] }>();
  let unchangedFiles = 0;

  for (const row of rows) {
    const relFolder = buildRelativeFolder(row, options.preset);
    const idealPath = path.join(resolvedRoot, relFolder, row.filename);

    if (path.resolve(row.path) === path.resolve(idealPath)) {
      unchangedFiles++;
      continue;
    }

    const finalDest = resolveCollision(idealPath, reserved);
    const relativeTarget = path.relative(resolvedRoot, finalDest);

    items.push({
      mediaId: row.id,
      filename: row.filename,
      mediaType: row.media_type,
      fromPath: row.path,
      toPath: finalDest,
      relativeTarget,
      category: row.ai_category || 'Uncategorized',
      year: row.year,
      month: row.month,
    });

    const group = treeMap.get(relFolder) || { count: 0, sampleFiles: [] };
    group.count++;
    if (group.sampleFiles.length < 4) {
      group.sampleFiles.push(path.basename(finalDest));
    }
    treeMap.set(relFolder, group);
  }

  const folderTree = Array.from(treeMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, info]) => ({
      folder,
      count: info.count,
      sampleFiles: info.sampleFiles,
    }));

  return {
    preset: options.preset,
    targetRoot: resolvedRoot,
    totalFiles: items.length,
    unchangedFiles,
    items,
    folderTree,
  };
}

function moveFileSafe(fromPath: string, toPath: string): void {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  try {
    fs.renameSync(fromPath, toPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EXDEV') {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
    } else {
      throw err;
    }
  }
}

function removeEmptyParentDirs(dirPath: string, stopAtRoot: string): void {
  const stop = path.resolve(stopAtRoot);
  let cur = path.resolve(dirPath);
  while (cur.startsWith(stop) && cur !== stop) {
    try {
      const entries = fs.readdirSync(cur);
      if (entries.length === 0) {
        fs.rmdirSync(cur);
        cur = path.dirname(cur);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

// Track paths touched by sorter so live folder watchers ignore self-induced moves
export const recentManagedPaths = new Map<string, number>();

export function markManagedPath(filePath: string): void {
  const now = Date.now();
  recentManagedPaths.set(path.resolve(filePath), now);
  if (recentManagedPaths.size > 500) {
    for (const [k, ts] of recentManagedPaths.entries()) {
      if (now - ts > 10000) recentManagedPaths.delete(k);
    }
  }
}

export function executeSortPlan(options: {
  preset: SortPreset;
  targetRoot: string;
  mode: 'copy' | 'move';
  folderId?: number | null;
  mediaIds?: number[];
  cleanupEmptyDirs?: boolean;
}): {
  operationId: string;
  processed: number;
  failed: Array<{ fromPath: string; error: string }>;
  targetRoot: string;
} {
  const plan = buildSortPlan(options);
  const completedMoves: Array<{ mediaId: number; fromPath: string; toPath: string }> = [];
  const failed: Array<{ fromPath: string; error: string }> = [];

  for (const item of plan.items) {
    try {
      if (!fs.existsSync(item.fromPath)) {
        failed.push({ fromPath: item.fromPath, error: 'Source file not found' });
        continue;
      }
      fs.mkdirSync(path.dirname(item.toPath), { recursive: true });
      markManagedPath(item.fromPath);
      markManagedPath(item.toPath);

      if (options.mode === 'copy') {
        fs.copyFileSync(item.fromPath, item.toPath);
      } else {
        const oldDir = path.dirname(item.fromPath);
        moveFileSafe(item.fromPath, item.toPath);
        db.prepare('UPDATE media SET path = ?, filename = ?, updated_at = ? WHERE id = ?').run(
          item.toPath,
          path.basename(item.toPath),
          new Date().toISOString(),
          item.mediaId
        );
        syncMediaFts(item.mediaId);
        if (options.cleanupEmptyDirs) {
          removeEmptyParentDirs(oldDir, plan.targetRoot);
        }
      }

      completedMoves.push({
        mediaId: item.mediaId,
        fromPath: item.fromPath,
        toPath: item.toPath,
      });
    } catch (err) {
      failed.push({
        fromPath: item.fromPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const operationId = crypto.randomUUID();
  if (completedMoves.length > 0) {
    db.prepare(
      `INSERT INTO sort_operations (id, created_at, mode, preset, target_root, moves_json, reverted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).run(
      operationId,
      new Date().toISOString(),
      options.mode,
      options.preset,
      plan.targetRoot,
      JSON.stringify(completedMoves)
    );
  }

  return {
    operationId,
    processed: completedMoves.length,
    failed,
    targetRoot: plan.targetRoot,
  };
}

export function autoOrganizeFolder(folderId: number): {
  operationId: string;
  processed: number;
  targetRoot: string;
} {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as unknown as
    | FolderRow
    | undefined;
  if (!folder) {
    throw new Error('Folder not found');
  }
  const targetRoot = folder.organize_target || folder.path;
  const preset = (folder.organize_preset || 'media-type') as SortPreset;
  const res = executeSortPlan({
    preset,
    targetRoot,
    mode: 'move',
    folderId: folder.id,
    cleanupEmptyDirs: true,
  });
  return {
    operationId: res.operationId,
    processed: res.processed,
    targetRoot: res.targetRoot,
  };
}

export function undoSortOperation(operationId: string): {
  reverted: number;
  failed: number;
} {
  const op = db
    .prepare('SELECT * FROM sort_operations WHERE id = ? AND reverted = 0')
    .get(operationId) as
    | {
        id: string;
        mode: 'copy' | 'move';
        moves_json: string;
      }
    | undefined;

  if (!op) {
    throw new Error('Sort operation not found or already reverted.');
  }

  const moves = JSON.parse(op.moves_json) as Array<{
    mediaId: number;
    fromPath: string;
    toPath: string;
  }>;

  let reverted = 0;
  let failed = 0;

  for (const m of moves) {
    try {
      markManagedPath(m.fromPath);
      markManagedPath(m.toPath);
      if (op.mode === 'copy') {
        if (fs.existsSync(m.toPath)) {
          fs.unlinkSync(m.toPath);
        }
        reverted++;
      } else {
        if (fs.existsSync(m.toPath)) {
          moveFileSafe(m.toPath, m.fromPath);
          db.prepare('UPDATE media SET path = ?, filename = ?, updated_at = ? WHERE id = ?').run(
            m.fromPath,
            path.basename(m.fromPath),
            new Date().toISOString(),
            m.mediaId
          );
          syncMediaFts(m.mediaId);
          reverted++;
        } else {
          failed++;
        }
      }
    } catch {
      failed++;
    }
  }

  db.prepare('UPDATE sort_operations SET reverted = 1 WHERE id = ?').run(operationId);
  return { reverted, failed };
}
