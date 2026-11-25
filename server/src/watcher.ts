import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from './config.js';
import { db, FolderRow } from './db.js';
import { startIndexingQueue } from './gemini.js';
import { PHOTO_EXTS, scanFolder, scanProgress, VIDEO_EXTS } from './scanner.js';
import { autoOrganizeFolder, recentManagedPaths } from './sorter.js';

const activeWatchers = new Map<number, fs.FSWatcher>();
const debounceTimers = new Map<number, NodeJS.Timeout>();

function isManagedEvent(folderPath: string, filename: string | null): boolean {
  if (!filename) return false;
  const full = path.resolve(folderPath, filename);
  const ts = recentManagedPaths.get(full);
  return typeof ts === 'number' && Date.now() - ts < 5000;
}

function isMediaFilename(filename: string | null): boolean {
  if (!filename) return false;
  const ext = path.extname(filename).toLowerCase();
  return PHOTO_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

export async function runFolderPipeline(folderId: number): Promise<void> {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as unknown as
    | FolderRow
    | undefined;
  if (!folder || !fs.existsSync(folder.path)) return;
  if (scanProgress.scanning) return;

  const settings = loadSettings();

  await scanFolder(folder.id, folder.path, async () => {
    const refreshed = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as unknown as
      | FolderRow
      | undefined;
    if (!refreshed) return;

    const needsAiFirst =
      refreshed.auto_organize === 1 && refreshed.organize_preset === 'media-type-category';

    if ((settings.autoIndexOnScan || needsAiFirst) && settings.apiKey) {
      if (needsAiFirst) {
        // Wait for Gemini classification before moving into AI Category folders
        await startIndexingQueue(false);
      } else {
        void startIndexingQueue(false);
      }
    }

    if (refreshed.auto_organize === 1) {
      try {
        autoOrganizeFolder(refreshed.id);
      } catch (err) {
        console.error(`Auto-organize error for folder ${refreshed.id}:`, err);
      }
    }
  });
}

export function startWatcherForFolder(folder: FolderRow): void {
  stopWatcherForFolder(folder.id);
  if (!folder.watch_enabled && !folder.auto_organize) return;
  if (!fs.existsSync(folder.path)) return;

  try {
    const watcher = fs.watch(
      folder.path,
      { recursive: true },
      (_eventType, filename) => {
        const name = filename ? String(filename) : null;
        if (!name || name.startsWith('.') || name.includes('.photovault')) return;
        if (isManagedEvent(folder.path, name)) return;
        if (!isMediaFilename(name)) return;

        const prev = debounceTimers.get(folder.id);
        if (prev) clearTimeout(prev);

        const timer = setTimeout(() => {
          debounceTimers.delete(folder.id);
          void runFolderPipeline(folder.id);
        }, 1800);
        debounceTimers.set(folder.id, timer);
      }
    );

    watcher.on('error', (err) => {
      console.warn(`Watcher error on ${folder.path}:`, err);
    });

    activeWatchers.set(folder.id, watcher);
  } catch {
    // Recursive fs.watch may fail on some network/virtual filesystems; ignore gracefully
  }
}

export function stopWatcherForFolder(folderId: number): void {
  const existing = activeWatchers.get(folderId);
  if (existing) {
    existing.close();
    activeWatchers.delete(folderId);
  }
  const timer = debounceTimers.get(folderId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(folderId);
  }
}

export function initAllWatchers(): void {
  const folders = db
    .prepare('SELECT * FROM folders WHERE watch_enabled = 1 OR auto_organize = 1')
    .all() as unknown as FolderRow[];
  for (const f of folders) {
    startWatcherForFolder(f);
  }
}
