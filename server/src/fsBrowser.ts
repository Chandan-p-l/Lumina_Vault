import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DirEntryInfo {
  name: string;
  path: string;
  hasChildren: boolean;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  shortcuts: Array<{ label: string; path: string }>;
  directories: DirEntryInfo[];
  mediaCountEstimate: number;
}

const MEDIA_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
  '.avif',
  '.gif',
  '.bmp',
  '.tiff',
  '.tif',
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.3gp',
]);

function getWindowsDrives(): Array<{ label: string; path: string }> {
  const drives: Array<{ label: string; path: string }> = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) {
        drives.push({ label: `Drive ${letter}:`, path: root });
      }
    } catch {
      // ignore unmounted drive
    }
  }
  return drives;
}

export function getShortcuts(): Array<{ label: string; path: string }> {
  const home = os.homedir();
  const candidates = [
    { label: 'Home', path: home },
    { label: 'Desktop', path: path.join(home, 'Desktop') },
    { label: 'Pictures', path: path.join(home, 'Pictures') },
    { label: 'Downloads', path: path.join(home, 'Downloads') },
    { label: 'Videos', path: path.join(home, 'Videos') },
    { label: 'Documents', path: path.join(home, 'Documents') },
  ];

  if (process.platform === 'win32') {
    candidates.push(...getWindowsDrives());
  } else {
    candidates.push({ label: 'Root (/)', path: '/' });
  }

  return candidates.filter((c) => {
    try {
      return fs.existsSync(c.path) && fs.statSync(c.path).isDirectory();
    } catch {
      return false;
    }
  });
}

export function browseDirectory(requestedPath?: string): BrowseResponse {
  const target = requestedPath ? path.resolve(requestedPath) : os.homedir();
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`Directory does not exist: ${target}`);
  }

  const parent = path.dirname(target);
  const parentPath = parent !== target ? parent : null;

  const entries = fs.readdirSync(target, { withFileTypes: true });
  const directories: DirEntryInfo[] = [];
  let mediaCountEstimate = 0;

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      let hasChildren = false;
      try {
        const sub = fs.readdirSync(fullPath, { withFileTypes: true });
        hasChildren = sub.some((s) => s.isDirectory() && !s.name.startsWith('.'));
      } catch {
        hasChildren = false;
      }
      directories.push({ name: entry.name, path: fullPath, hasChildren });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTS.has(ext)) mediaCountEstimate++;
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return {
    currentPath: target,
    parentPath,
    shortcuts: getShortcuts(),
    directories,
    mediaCountEstimate,
  };
}
