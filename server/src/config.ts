import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

function resolveDataDir(): string {
  if (process.env.LUMINA_DATA_DIR) {
    return path.resolve(process.env.LUMINA_DATA_DIR);
  }
  const localVault = path.join(PROJECT_ROOT, '.photovault');
  try {
    fs.mkdirSync(localVault, { recursive: true });
    return localVault;
  } catch {
    // Fallback to OS config/data dir if application directory is read-only
    const base =
      process.platform === 'win32'
        ? process.env.APPDATA || os.homedir()
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'lumina-vault');
  }
}

export const PHOTOVAULT_DIR = resolveDataDir();
export const THUMBS_DIR = path.join(PHOTOVAULT_DIR, 'thumbs');
export const UPLOADS_DIR = path.join(PHOTOVAULT_DIR, 'uploads');
export const DB_PATH = path.join(PHOTOVAULT_DIR, 'vault.db');
export const SETTINGS_PATH = path.join(PHOTOVAULT_DIR, 'settings.json');

fs.mkdirSync(THUMBS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export interface AppSettings {
  apiKey: string;
  apiMode: 'auto' | 'gemini' | 'vertex';
  visionModel: string;
  embeddingModel: string;
  concurrency: number;
  autoIndexOnScan: boolean;
  defaultSortMode: 'copy' | 'move';
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: process.env.GEMINI_API_KEY || '',
  apiMode: 'auto',
  visionModel: 'gemini-2.5-flash',
  embeddingModel: 'gemini-embedding-001',
  concurrency: 3,
  autoIndexOnScan: true,
  defaultSortMode: 'move',
};

export function loadSettings(): AppSettings {
  let saved: Partial<AppSettings> = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch {
      saved = {};
    }
  }
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    apiKey: saved.apiKey || process.env.GEMINI_API_KEY || '',
  };
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...partial,
  };
  fs.mkdirSync(PHOTOVAULT_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '••••••••';
  return `${key.slice(0, 7)}••••••${key.slice(-4)}`;
}
