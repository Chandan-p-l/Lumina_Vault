import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    added_at TEXT NOT NULL,
    last_scanned_at TEXT,
    status TEXT DEFAULT 'idle',
    auto_organize INTEGER NOT NULL DEFAULT 0,
    organize_preset TEXT NOT NULL DEFAULT 'media-type',
    organize_target TEXT,
    watch_enabled INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    ext TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('photo', 'video')),
    size_bytes INTEGER NOT NULL,
    hash TEXT,
    width INTEGER,
    height INTEGER,
    duration_sec REAL,
    captured_at TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    camera_make TEXT,
    camera_model TEXT,
    gps_lat REAL,
    gps_lng REAL,
    thumb_path TEXT,
    keyframes_json TEXT DEFAULT '[]',
    ai_status TEXT NOT NULL DEFAULT 'pending' CHECK(ai_status IN ('pending', 'processing', 'indexed', 'error')),
    ai_error TEXT,
    ai_caption TEXT,
    ai_tags_json TEXT DEFAULT '[]',
    ai_category TEXT,
    ai_objects_json TEXT DEFAULT '[]',
    ai_people_pets TEXT,
    ai_mood TEXT,
    ai_text_ocr TEXT,
    embedding_json TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_id);
  CREATE INDEX IF NOT EXISTS idx_media_year_month ON media(year, month);
  CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
  CREATE INDEX IF NOT EXISTS idx_media_ai_status ON media(ai_status);
  CREATE INDEX IF NOT EXISTS idx_media_category ON media(ai_category);
  CREATE INDEX IF NOT EXISTS idx_media_hash ON media(hash);
  CREATE INDEX IF NOT EXISTS idx_media_captured ON media(captured_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
    media_id UNINDEXED,
    filename,
    ai_caption,
    ai_tags,
    ai_category,
    ai_people_pets,
    ai_text_ocr,
    folder_name
  );

  CREATE TABLE IF NOT EXISTS sort_operations (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('copy', 'move')),
    preset TEXT NOT NULL,
    target_root TEXT NOT NULL,
    moves_json TEXT NOT NULL,
    reverted INTEGER NOT NULL DEFAULT 0
  );
`);

// Safe migrations for existing databases created before auto-organize columns
const folderCols = db.prepare('PRAGMA table_info(folders)').all() as Array<{ name: string }>;
const folderColNames = new Set(folderCols.map((c) => c.name));
if (!folderColNames.has('auto_organize')) {
  db.exec(`ALTER TABLE folders ADD COLUMN auto_organize INTEGER NOT NULL DEFAULT 0`);
}
if (!folderColNames.has('organize_preset')) {
  db.exec(`ALTER TABLE folders ADD COLUMN organize_preset TEXT NOT NULL DEFAULT 'media-type'`);
}
if (!folderColNames.has('organize_target')) {
  db.exec(`ALTER TABLE folders ADD COLUMN organize_target TEXT`);
}
if (!folderColNames.has('watch_enabled')) {
  db.exec(`ALTER TABLE folders ADD COLUMN watch_enabled INTEGER NOT NULL DEFAULT 0`);
}

export interface FolderRow {
  id: number;
  path: string;
  name: string;
  added_at: string;
  last_scanned_at: string | null;
  status: string;
  auto_organize: number;
  organize_preset: string;
  organize_target: string | null;
  watch_enabled: number;
}

export interface MediaRow {
  id: number;
  folder_id: number;
  path: string;
  filename: string;
  ext: string;
  media_type: 'photo' | 'video';
  size_bytes: number;
  hash: string | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  captured_at: string;
  year: number;
  month: number;
  camera_make: string | null;
  camera_model: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  thumb_path: string | null;
  keyframes_json: string;
  ai_status: 'pending' | 'processing' | 'indexed' | 'error';
  ai_error: string | null;
  ai_caption: string | null;
  ai_tags_json: string;
  ai_category: string | null;
  ai_objects_json: string;
  ai_people_pets: string | null;
  ai_mood: string | null;
  ai_text_ocr: string | null;
  embedding_json: string | null;
  favorite: number;
  created_at: string;
  updated_at: string;
}

export function syncMediaFts(mediaId: number): void {
  const row = db
    .prepare(
      `SELECT m.id, m.filename, m.ai_caption, m.ai_tags_json, m.ai_category, m.ai_people_pets, m.ai_text_ocr, f.name as folder_name
       FROM media m
       JOIN folders f ON f.id = m.folder_id
       WHERE m.id = ?`
    )
    .get(mediaId) as
    | {
        id: number;
        filename: string;
        ai_caption: string | null;
        ai_tags_json: string;
        ai_category: string | null;
        ai_people_pets: string | null;
        ai_text_ocr: string | null;
        folder_name: string;
      }
    | undefined;

  db.prepare('DELETE FROM media_fts WHERE media_id = ?').run(mediaId);
  if (!row) return;

  let tagsText = '';
  try {
    const parsed = JSON.parse(row.ai_tags_json || '[]');
    if (Array.isArray(parsed)) tagsText = parsed.join(', ');
  } catch {
    tagsText = '';
  }

  db.prepare(
    `INSERT INTO media_fts (media_id, filename, ai_caption, ai_tags, ai_category, ai_people_pets, ai_text_ocr, folder_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.filename || '',
    row.ai_caption || '',
    tagsText,
    row.ai_category || '',
    row.ai_people_pets || '',
    row.ai_text_ocr || '',
    row.folder_name || ''
  );
}

export function deleteFolderFromDb(folderId: number): void {
  const mediaIds = db
    .prepare('SELECT id FROM media WHERE folder_id = ?')
    .all(folderId) as Array<{ id: number }>;
  for (const item of mediaIds) {
    db.prepare('DELETE FROM media_fts WHERE media_id = ?').run(item.id);
  }
  db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
}
