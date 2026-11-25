import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, FolderRow, MediaRow, syncMediaFts } from './db.js';

export type SortPreset =
  | 'media-type'
  | 'media-type-category'
  | 'year-month'
  | 'year-category'
  | 'category-year'
  | 'custom';

export type FilenamePattern = 'original' | 'date_original' | 'date_caption' | 'sequence';
export type DuplicatePolicy = 'rename' | 'separate_folder' | 'skip';

export interface SortRuleConfig {
  preset: SortPreset;
  folderPattern?: string;
  filenamePattern?: FilenamePattern;
  mediaFilter?: 'all' | 'photo' | 'video';
  duplicatePolicy?: DuplicatePolicy;
  separateScreenshots?: boolean;
  cleanupEmptyDirs?: boolean;
}

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
  isDuplicate?: boolean;
}

export interface SortPlanResult {
  preset: SortPreset;
  folderPattern: string;
  targetRoot: string;
  totalFiles: number;
  unchangedFiles: number;
  skippedDuplicates: number;
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

export const PRESET_PATTERNS: Record<Exclude<SortPreset, 'custom'>, string> = {
  'media-type': '{type}/{year}/{month_name}',
  'media-type-category': '{type}/{category}/{year}',
  'year-month': '{year}/{month_name}/{type}',
  'year-category': '{year}/{category}',
  'category-year': '{category}/{year}',
};

function sanitizeSegment(segment: string): string {
  return (
    segment
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'General'
  );
}

function slugifyCaption(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 42);
}

function inferLocalCategory(item: MediaRow): string {
  if (item.ai_category && item.ai_category.trim()) {
    return item.ai_category.trim();
  }
  const lower = item.filename.toLowerCase();
  if (lower.includes('screenshot') || lower.includes('screen_shot') || lower.includes('screencast')) {
    return 'Screenshots & UI';
  }
  if (item.ext === '.gif') return 'GIFs & Clips';
  if (item.camera_make || item.camera_model) return 'Camera Roll';
  return item.media_type === 'video' ? 'Videos General' : 'Photos General';
}

function isScreenshotItem(item: MediaRow): boolean {
  if (item.ai_category === 'Screenshots & UI') return true;
  const lower = item.filename.toLowerCase();
  return lower.includes('screenshot') || lower.includes('screen shot') || lower.includes('screen_shot');
}

function getOrientationLabel(item: MediaRow): string {
  if (!item.width || !item.height) return 'Standard';
  if (item.width === item.height) return 'Square';
  return item.width > item.height ? 'Landscape' : 'Portrait';
}

function getResolutionLabel(item: MediaRow): string {
  const maxDim = Math.max(item.width || 0, item.height || 0);
  if (maxDim >= 3840) return '4K & Ultra-HD';
  if (maxDim >= 1920) return 'Full HD (1080p+)';
  if (maxDim > 0) return 'Standard Res';
  return 'Unknown Res';
}

function getCameraLabel(item: MediaRow): string {
  const label = [item.camera_make, item.camera_model].filter(Boolean).join(' ').trim();
  return label ? sanitizeSegment(label) : 'Unknown Camera';
}

export function resolveFolderPattern(rule: SortRuleConfig): string {
  if (rule.preset === 'custom' && rule.folderPattern?.trim()) {
    return rule.folderPattern.trim();
  }
  if (rule.folderPattern?.trim() && rule.preset !== 'custom') {
    return rule.folderPattern.trim();
  }
  return PRESET_PATTERNS[rule.preset === 'custom' ? 'media-type' : rule.preset] || '{type}/{year}/{month_name}';
}

function buildRelativeFolder(
  item: MediaRow,
  rule: SortRuleConfig,
  folderNameMap: Map<number, string>,
  isDup: boolean
): string {
  const yearStr = String(item.year || new Date().getFullYear());
  const monthIdx = Math.min(12, Math.max(1, item.month || 1)) - 1;
  const monthNum = String(monthIdx + 1).padStart(2, '0');
  const monthStr = MONTH_NAMES[monthIdx];
  const dayStr = item.captured_at ? item.captured_at.slice(0, 10) : `${yearStr}-${monthNum}-01`;
  const typeFolder = item.media_type === 'video' ? 'Videos' : 'Photos';
  const category = sanitizeSegment(inferLocalCategory(item));

  if (isDup && rule.duplicatePolicy === 'separate_folder') {
    return path.join('_Duplicates', yearStr, typeFolder);
  }

  if (rule.separateScreenshots && isScreenshotItem(item)) {
    return path.join('Screenshots', yearStr, monthStr);
  }

  const pattern = resolveFolderPattern(rule);
  const tokens: Record<string, string> = {
    type: typeFolder,
    year: yearStr,
    month: monthNum,
    month_name: monthStr,
    day: dayStr,
    category,
    camera: getCameraLabel(item),
    orientation: getOrientationLabel(item),
    resolution: getResolutionLabel(item),
    extension: item.ext.replace('.', '').toUpperCase() || 'FILE',
    source: sanitizeSegment(folderNameMap.get(item.folder_id) || 'Vault'),
  };

  const segments = pattern
    .split(/[/\\]+/)
    .map((rawSeg) => {
      const replaced = rawSeg.replace(/\{([a-z_]+)\}/gi, (_, key: string) => {
        const val = tokens[key.toLowerCase()];
        return val !== undefined ? val : key;
      });
      return sanitizeSegment(replaced);
    })
    .filter((s) => s && s !== '.' && s !== '..');

  return segments.length > 0 ? path.join(...segments) : path.join(typeFolder, yearStr, monthStr);
}

function buildTargetFilename(item: MediaRow, filenamePattern: FilenamePattern, seqIndex: number): string {
  const ext = path.extname(item.filename) || item.ext || '';
  const base = path.basename(item.filename, ext);
  const datePart = item.captured_at ? item.captured_at.slice(0, 10) : `${item.year}-${String(item.month).padStart(2, '0')}-01`;
  const timePart = item.captured_at && item.captured_at.length >= 16
    ? item.captured_at.slice(11, 16).replace(':', '-')
    : '00-00';

  switch (filenamePattern) {
    case 'date_original':
      if (base.startsWith(datePart)) return item.filename;
      return `${datePart}_${base}${ext}`;
    case 'date_caption': {
      const slug = item.ai_caption ? slugifyCaption(item.ai_caption) : '';
      const suffix = slug || sanitizeSegment(base);
      return `${datePart}_${timePart}_${suffix}${ext}`;
    }
    case 'sequence':
      return `${String(seqIndex + 1).padStart(4, '0')}_${datePart}${ext}`;
    case 'original':
    default:
      return item.filename;
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
  folderPattern?: string;
  filenamePattern?: FilenamePattern;
  mediaFilter?: 'all' | 'photo' | 'video';
  duplicatePolicy?: DuplicatePolicy;
  separateScreenshots?: boolean;
  folderId?: number | null;
  mediaIds?: number[];
}): SortPlanResult {
  const resolvedRoot = path.resolve(options.targetRoot);
  const rule: SortRuleConfig = {
    preset: options.preset || 'media-type',
    folderPattern: options.folderPattern,
    filenamePattern: options.filenamePattern || 'original',
    mediaFilter: options.mediaFilter || 'all',
    duplicatePolicy: options.duplicatePolicy || 'rename',
    separateScreenshots: Boolean(options.separateScreenshots),
  };

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

  if (rule.mediaFilter && rule.mediaFilter !== 'all') {
    rows = rows.filter((r) => r.media_type === rule.mediaFilter);
  }

  const folderRows = db.prepare('SELECT id, name FROM folders').all() as Array<{
    id: number;
    name: string;
  }>;
  const folderNameMap = new Map(folderRows.map((f) => [f.id, f.name]));

  const reserved = new Set<string>();
  const seenHashes = new Set<string>();
  const items: SortPlanItem[] = [];
  const treeMap = new Map<string, { count: number; sampleFiles: string[] }>();
  let unchangedFiles = 0;
  let skippedDuplicates = 0;

  rows.forEach((row, idx) => {
    const isDup = Boolean(row.hash && seenHashes.has(row.hash));
    if (row.hash) seenHashes.add(row.hash);

    if (isDup && rule.duplicatePolicy === 'skip') {
      skippedDuplicates++;
      return;
    }

    const relFolder = buildRelativeFolder(row, rule, folderNameMap, isDup);
    const desiredName = buildTargetFilename(row, rule.filenamePattern || 'original', idx);
    const idealPath = path.join(resolvedRoot, relFolder, desiredName);

    if (path.resolve(row.path) === path.resolve(idealPath)) {
      unchangedFiles++;
      return;
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
      category: inferLocalCategory(row),
      year: row.year,
      month: row.month,
      isDuplicate: isDup,
    });

    const group = treeMap.get(relFolder) || { count: 0, sampleFiles: [] };
    group.count++;
    if (group.sampleFiles.length < 4) {
      group.sampleFiles.push(path.basename(finalDest));
    }
    treeMap.set(relFolder, group);
  });

  const folderTree = Array.from(treeMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, info]) => ({
      folder,
      count: info.count,
      sampleFiles: info.sampleFiles,
    }));

  return {
    preset: rule.preset,
    folderPattern: resolveFolderPattern(rule),
    targetRoot: resolvedRoot,
    totalFiles: items.length,
    unchangedFiles,
    skippedDuplicates,
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

export const recentManagedPaths = new Map<string, number>();

export interface SortProgressState {
  sorting: boolean;
  mode: 'copy' | 'move';
  preset: SortPreset;
  targetRoot: string | null;
  totalFiles: number;
  processedFiles: number;
  createdFolders: string[];
  recentMoves: Array<{
    mediaId: number;
    filename: string;
    mediaType: 'photo' | 'video';
    toFolder: string;
    thumbUrl: string | null;
  }>;
  operationId: string | null;
  error: string | null;
}

export const sortProgress: SortProgressState = {
  sorting: false,
  mode: 'move',
  preset: 'media-type',
  targetRoot: null,
  totalFiles: 0,
  processedFiles: 0,
  createdFolders: [],
  recentMoves: [],
  operationId: null,
  error: null,
};

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
  folderPattern?: string;
  filenamePattern?: FilenamePattern;
  mediaFilter?: 'all' | 'photo' | 'video';
  duplicatePolicy?: DuplicatePolicy;
  separateScreenshots?: boolean;
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

  sortProgress.sorting = true;
  sortProgress.mode = options.mode;
  sortProgress.preset = options.preset;
  sortProgress.targetRoot = plan.targetRoot;
  sortProgress.totalFiles = plan.items.length;
  sortProgress.processedFiles = 0;
  sortProgress.createdFolders = [];
  sortProgress.recentMoves = [];
  sortProgress.operationId = null;
  sortProgress.error = null;

  const seenFolders = new Set<string>();
  const thumbStmt = db.prepare('SELECT thumb_path FROM media WHERE id = ?');

  try {
    for (const item of plan.items) {
      try {
        if (!fs.existsSync(item.fromPath)) {
          failed.push({ fromPath: item.fromPath, error: 'Source file not found' });
          sortProgress.processedFiles++;
          continue;
        }
        const destDir = path.dirname(item.toPath);
        const relDir = path.relative(plan.targetRoot, destDir) || '.';
        if (!seenFolders.has(relDir)) {
          seenFolders.add(relDir);
          sortProgress.createdFolders = [...sortProgress.createdFolders, relDir];
        }

        fs.mkdirSync(destDir, { recursive: true });
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

        const thumbRow = thumbStmt.get(item.mediaId) as { thumb_path?: string | null } | undefined;
        sortProgress.recentMoves = [
          ...sortProgress.recentMoves.slice(-29),
          {
            mediaId: item.mediaId,
            filename: item.filename,
            mediaType: item.mediaType,
            toFolder: relDir,
            thumbUrl: thumbRow?.thumb_path ? `/api/thumbs/${thumbRow.thumb_path}` : null,
          },
        ];

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
      sortProgress.processedFiles++;
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
        options.folderPattern ? `custom:${options.folderPattern}` : options.preset,
        plan.targetRoot,
        JSON.stringify(completedMoves)
      );
    }
    sortProgress.operationId = operationId;

    return {
      operationId,
      processed: completedMoves.length,
      failed,
      targetRoot: plan.targetRoot,
    };
  } finally {
    sortProgress.sorting = false;
  }
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
  let customRule: Partial<SortRuleConfig> = {};
  if (folder.organize_rule_json) {
    try {
      customRule = JSON.parse(folder.organize_rule_json) as Partial<SortRuleConfig>;
    } catch {
      customRule = {};
    }
  }
  const targetRoot = folder.organize_target || folder.path;
  const preset = (customRule.preset || folder.organize_preset || 'media-type') as SortPreset;
  const res = executeSortPlan({
    preset,
    folderPattern: customRule.folderPattern,
    filenamePattern: customRule.filenamePattern,
    mediaFilter: customRule.mediaFilter,
    duplicatePolicy: customRule.duplicatePolicy,
    separateScreenshots: customRule.separateScreenshots,
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
