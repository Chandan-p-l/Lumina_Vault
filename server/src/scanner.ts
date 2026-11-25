import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import exifr from 'exifr';
import sharp from 'sharp';
import { THUMBS_DIR } from './config.js';
import { db, syncMediaFts } from './db.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function resolveBinary(pkgName: string, fallbackCmd: string): string {
  try {
    const mod = require(pkgName) as { path?: string };
    if (mod?.path) {
      const unpacked = mod.path.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpacked)) return unpacked;
      if (fs.existsSync(mod.path)) return mod.path;
    }
  } catch {
    // fallback to system PATH binary
  }
  return fallbackCmd;
}

const FFMPEG_BIN = resolveBinary('@ffmpeg-installer/ffmpeg', 'ffmpeg');
const FFPROBE_BIN = resolveBinary('@ffprobe-installer/ffprobe', 'ffprobe');

export const PHOTO_EXTS = new Set([
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
]);

export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.3gp']);

const IGNORED_DIRS = new Set(['node_modules', '.git', '.photovault', '@eaDir', '$RECYCLE.BIN']);

export interface ScanProgress {
  scanning: boolean;
  folderId: number | null;
  folderPath: string | null;
  totalFiles: number;
  processedFiles: number;
  addedFiles: number;
  skippedFiles: number;
  currentFile: string | null;
  error: string | null;
}

export const scanProgress: ScanProgress = {
  scanning: false,
  folderId: null,
  folderPath: null,
  totalFiles: 0,
  processedFiles: 0,
  addedFiles: 0,
  skippedFiles: 0,
  currentFile: null,
  error: null,
};

function walkMediaFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (PHOTO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}

function computeFastHash(filePath: string, sizeBytes: number): string {
  const hash = crypto.createHash('sha256');
  hash.update(String(sizeBytes));
  const chunkSize = 64 * 1024;

  const fd = fs.openSync(filePath, 'r');
  try {
    if (sizeBytes <= chunkSize * 2) {
      const buf = Buffer.alloc(sizeBytes);
      fs.readSync(fd, buf, 0, sizeBytes, 0);
      hash.update(buf);
    } else {
      const head = Buffer.alloc(chunkSize);
      const tail = Buffer.alloc(chunkSize);
      fs.readSync(fd, head, 0, chunkSize, 0);
      fs.readSync(fd, tail, 0, chunkSize, sizeBytes - chunkSize);
      hash.update(head);
      hash.update(tail);
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex').slice(0, 32);
}

interface ExtractedMeta {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  capturedAt: Date;
  cameraMake: string | null;
  cameraModel: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

async function extractPhotoMeta(filePath: string, fallbackMtime: Date): Promise<ExtractedMeta> {
  let width: number | null = null;
  let height: number | null = null;
  let capturedAt = fallbackMtime;
  let cameraMake: string | null = null;
  let cameraModel: string | null = null;
  let gpsLat: number | null = null;
  let gpsLng: number | null = null;

  try {
    const exif = await exifr.parse(filePath, {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'ModifyDate',
        'Make',
        'Model',
        'ImageWidth',
        'ImageHeight',
        'ExifImageWidth',
        'ExifImageHeight',
        'latitude',
        'longitude',
      ],
    });
    if (exif) {
      const dt = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
      if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
        capturedAt = dt;
      }
      if (typeof exif.Make === 'string') cameraMake = exif.Make.trim();
      if (typeof exif.Model === 'string') cameraModel = exif.Model.trim();
      if (typeof exif.latitude === 'number' && Number.isFinite(exif.latitude)) gpsLat = exif.latitude;
      if (typeof exif.longitude === 'number' && Number.isFinite(exif.longitude)) gpsLng = exif.longitude;
      width = exif.ExifImageWidth || exif.ImageWidth || null;
      height = exif.ExifImageHeight || exif.ImageHeight || null;
    }
  } catch {
    // EXIF optional
  }

  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    if (meta.width && meta.height) {
      const swapped = meta.orientation && meta.orientation >= 5 && meta.orientation <= 8;
      width = swapped ? meta.height : meta.width;
      height = swapped ? meta.width : meta.height;
    }
  } catch {
    // ignore
  }

  return {
    width,
    height,
    durationSec: null,
    capturedAt,
    cameraMake,
    cameraModel,
    gpsLat,
    gpsLng,
  };
}

async function extractVideoMeta(filePath: string, fallbackMtime: Date): Promise<ExtractedMeta> {
  let width: number | null = null;
  let height: number | null = null;
  let durationSec: number | null = null;
  let capturedAt = fallbackMtime;

  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const data = JSON.parse(stdout);
    const vStream = Array.isArray(data.streams)
      ? data.streams.find((s: { codec_type?: string }) => s.codec_type === 'video')
      : null;
    if (vStream) {
      width = typeof vStream.width === 'number' ? vStream.width : null;
      height = typeof vStream.height === 'number' ? vStream.height : null;
    }
    if (data.format?.duration) {
      const parsedDur = Number.parseFloat(data.format.duration);
      if (Number.isFinite(parsedDur)) durationSec = parsedDur;
    }
    const creationTime =
      data.format?.tags?.creation_time || vStream?.tags?.creation_time || null;
    if (creationTime) {
      const dt = new Date(creationTime);
      if (!Number.isNaN(dt.getTime())) capturedAt = dt;
    }
  } catch {
    // ffprobe optional fallback
  }

  return {
    width,
    height,
    durationSec,
    capturedAt,
    cameraMake: null,
    cameraModel: null,
    gpsLat: null,
    gpsLng: null,
  };
}

async function generatePhotoThumb(filePath: string, thumbName: string): Promise<string | null> {
  const outPath = path.join(THUMBS_DIR, thumbName);
  try {
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(outPath);
    return thumbName;
  } catch {
    try {
      await execFileAsync(FFMPEG_BIN, [
        '-y',
        '-i',
        filePath,
        '-vf',
        'scale=768:-2',
        '-frames:v',
        '1',
        outPath,
      ]);
      if (fs.existsSync(outPath)) return thumbName;
    } catch {
      return null;
    }
    return null;
  }
}

async function generateVideoKeyframes(
  filePath: string,
  baseKey: string,
  durationSec: number | null
): Promise<{ thumbPath: string | null; keyframes: string[] }> {
  const dur = durationSec && durationSec > 0.5 ? durationSec : 1;
  const fractions = dur >= 3 ? [0.1, 0.5, 0.82] : [0.25];
  const keyframes: string[] = [];

  for (let i = 0; i < fractions.length; i++) {
    const ts = Math.max(0, dur * fractions[i]);
    const name = `${baseKey}_kf${i}.webp`;
    const outPath = path.join(THUMBS_DIR, name);
    try {
      await execFileAsync(FFMPEG_BIN, [
        '-y',
        '-ss',
        ts.toFixed(2),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=768:-2',
        '-c:v',
        'libwebp',
        '-quality',
        '80',
        outPath,
      ]);
      if (fs.existsSync(outPath)) {
        keyframes.push(name);
      }
    } catch {
      // try next frame
    }
  }

  if (keyframes.length === 0) {
    const fallbackName = `${baseKey}_kf0.webp`;
    const outPath = path.join(THUMBS_DIR, fallbackName);
    try {
      await execFileAsync(FFMPEG_BIN, [
        '-y',
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=768:-2',
        '-c:v',
        'libwebp',
        '-quality',
        '80',
        outPath,
      ]);
      if (fs.existsSync(outPath)) keyframes.push(fallbackName);
    } catch {
      // ignore
    }
  }

  return {
    thumbPath: keyframes[0] || null,
    keyframes,
  };
}

export async function scanFolder(
  folderId: number,
  folderPath: string,
  onNewMediaQueued?: () => void | Promise<void>
): Promise<void> {
  if (scanProgress.scanning) {
    throw new Error('A folder scan is already in progress.');
  }

  scanProgress.scanning = true;
  scanProgress.folderId = folderId;
  scanProgress.folderPath = folderPath;
  scanProgress.totalFiles = 0;
  scanProgress.processedFiles = 0;
  scanProgress.addedFiles = 0;
  scanProgress.skippedFiles = 0;
  scanProgress.currentFile = null;
  scanProgress.error = null;

  db.prepare(`UPDATE folders SET status = 'scanning' WHERE id = ?`).run(folderId);

  try {
    const files = walkMediaFiles(folderPath);
    scanProgress.totalFiles = files.length;

    const existingStmt = db.prepare('SELECT id, size_bytes FROM media WHERE path = ?');
    const insertStmt = db.prepare(`
      INSERT INTO media (
        folder_id, path, filename, ext, media_type, size_bytes, hash,
        width, height, duration_sec, captured_at, year, month,
        camera_make, camera_model, gps_lat, gps_lng, thumb_path, keyframes_json,
        ai_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    for (const filePath of files) {
      scanProgress.currentFile = path.basename(filePath);
      try {
        const stat = fs.statSync(filePath);
        const existing = existingStmt.get(filePath) as
          | { id: number; size_bytes: number }
          | undefined;

        if (existing && existing.size_bytes === stat.size) {
          scanProgress.skippedFiles++;
          scanProgress.processedFiles++;
          continue;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mediaType: 'photo' | 'video' = VIDEO_EXTS.has(ext) ? 'video' : 'photo';
        const hash = computeFastHash(filePath, stat.size);
        const fallbackMtime = stat.mtime;

        const meta =
          mediaType === 'photo'
            ? await extractPhotoMeta(filePath, fallbackMtime)
            : await extractVideoMeta(filePath, fallbackMtime);

        const uniqueKey = crypto
          .createHash('sha1')
          .update(`${filePath}:${stat.size}`)
          .digest('hex')
          .slice(0, 20);

        let thumbPath: string | null = null;
        let keyframes: string[] = [];

        if (mediaType === 'photo') {
          thumbPath = await generatePhotoThumb(filePath, `${uniqueKey}.webp`);
        } else {
          const vThumbs = await generateVideoKeyframes(filePath, uniqueKey, meta.durationSec);
          thumbPath = vThumbs.thumbPath;
          keyframes = vThumbs.keyframes;
        }

        const nowIso = new Date().toISOString();
        const capturedIso = meta.capturedAt.toISOString();
        const year = meta.capturedAt.getFullYear();
        const month = meta.capturedAt.getMonth() + 1;

        if (existing) {
          db.prepare(
            `UPDATE media SET size_bytes = ?, hash = ?, width = ?, height = ?, duration_sec = ?,
             captured_at = ?, year = ?, month = ?, thumb_path = ?, keyframes_json = ?, updated_at = ?
             WHERE id = ?`
          ).run(
            stat.size,
            hash,
            meta.width,
            meta.height,
            meta.durationSec,
            capturedIso,
            year,
            month,
            thumbPath,
            JSON.stringify(keyframes),
            nowIso,
            existing.id
          );
          syncMediaFts(existing.id);
        } else {
          const res = insertStmt.run(
            folderId,
            filePath,
            path.basename(filePath),
            ext,
            mediaType,
            stat.size,
            hash,
            meta.width,
            meta.height,
            meta.durationSec,
            capturedIso,
            year,
            month,
            meta.cameraMake,
            meta.cameraModel,
            meta.gpsLat,
            meta.gpsLng,
            thumbPath,
            JSON.stringify(keyframes),
            nowIso,
            nowIso
          );
          const insertedId = Number(res.lastInsertRowid);
          syncMediaFts(insertedId);
          scanProgress.addedFiles++;
        }
      } catch (err) {
        console.error(`Failed processing ${filePath}:`, err);
      }

      scanProgress.processedFiles++;
    }

    const folderRows = db
      .prepare('SELECT id, path FROM media WHERE folder_id = ?')
      .all(folderId) as Array<{ id: number; path: string }>;
    for (const row of folderRows) {
      if (!fs.existsSync(row.path)) {
        db.prepare('DELETE FROM media_fts WHERE media_id = ?').run(row.id);
        db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
      }
    }

    db.prepare(`UPDATE folders SET last_scanned_at = ?, status = 'idle' WHERE id = ?`).run(
      new Date().toISOString(),
      folderId
    );

    // Mark scan complete BEFORE launching background AI indexing / auto-organize pipeline
    scanProgress.scanning = false;
    scanProgress.currentFile = null;

    if (onNewMediaQueued) {
      await onNewMediaQueued();
    }
  } catch (err) {
    scanProgress.error = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE folders SET status = 'error' WHERE id = ?`).run(folderId);
  } finally {
    scanProgress.scanning = false;
    scanProgress.currentFile = null;
  }
}
