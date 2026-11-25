export interface FolderItem {
  id: number;
  path: string;
  name: string;
  added_at: string;
  last_scanned_at: string | null;
  status: string;
  auto_organize?: number;
  organize_preset?: string;
  organize_target?: string | null;
  watch_enabled?: number;
  item_count?: number;
  indexed_count?: number;
}

export interface MediaItem {
  id: number;
  folderId: number;
  path: string;
  filename: string;
  ext: string;
  mediaType: 'photo' | 'video';
  sizeBytes: number;
  hash: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  capturedAt: string;
  year: number;
  month: number;
  cameraMake: string | null;
  cameraModel: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  thumbUrl: string | null;
  keyframeUrls: string[];
  fileUrl: string;
  aiStatus: 'pending' | 'processing' | 'indexed' | 'error';
  aiError: string | null;
  aiCaption: string | null;
  aiTags: string[];
  aiCategory: string | null;
  aiObjects: string[];
  aiPeoplePets: string | null;
  aiMood: string | null;
  aiTextOcr: string | null;
  favorite: boolean;
  score?: number;
  matchReason?: string;
}

export interface VaultStatus {
  counts: {
    total: number;
    photos: number;
    videos: number;
    indexed: number;
    pending: number;
    errors: number;
    favorites: number;
    duplicateGroups: number;
  };
  categories: Array<{ category: string; count: number }>;
  timeline: Array<{ year: number; month: number; count: number }>;
  scanProgress: {
    scanning: boolean;
    folderId: number | null;
    folderPath: string | null;
    totalFiles: number;
    processedFiles: number;
    addedFiles: number;
    skippedFiles: number;
    currentFile: string | null;
    error: string | null;
  };
  indexingState: {
    running: boolean;
    paused: boolean;
    totalPending: number;
    processedInRun: number;
    succeededInRun: number;
    failedInRun: number;
    currentFilename: string | null;
    lastError: string | null;
    resolvedEndpointMode: 'gemini' | 'vertex' | null;
  };
  sortProgress?: {
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
  };
  hasApiKey: boolean;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  shortcuts: Array<{ label: string; path: string }>;
  directories: Array<{ name: string; path: string; hasChildren: boolean }>;
  mediaCountEstimate: number;
}

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
  classifyFirst?: boolean;
}

export interface SortPlanResult {
  preset: SortPreset;
  folderPattern: string;
  targetRoot: string;
  totalFiles: number;
  unchangedFiles: number;
  skippedDuplicates: number;
  items: Array<{
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
  }>;
  folderTree: Array<{ folder: string; count: number; sampleFiles: string[] }>;
}

export interface SortHistoryItem {
  id: string;
  createdAt: string;
  mode: 'copy' | 'move';
  preset: string;
  targetRoot: string;
  fileCount: number;
  reverted: boolean;
}

export interface SettingsData {
  maskedApiKey: string;
  hasApiKey: boolean;
  apiMode: 'auto' | 'gemini' | 'vertex';
  visionModel: string;
  embeddingModel: string;
  concurrency: number;
  autoIndexOnScan: boolean;
  defaultSortMode: 'copy' | 'move';
  resolvedEndpointMode?: 'gemini' | 'vertex' | null;
}

export interface MediaTelemetry {
  whiteBalance: {
    mode: string;
    lightSource: string | null;
    colorSpace: string;
    kelvin: number;
    tempLabel: string;
    tint: number;
    rgbMeans: { r: number; g: number; b: number };
    rgbGains: { r: number; g: number; b: number };
  };
  exposure: {
    iso: number | null;
    fNumber: number | null;
    exposureTime: number | null;
    focalLength: number | null;
  };
}

export type NavSection =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'duplicates' }
  | { type: 'folder'; folderId: number; name: string }
  | { type: 'category'; category: string }
  | { type: 'timeline'; year: number; month?: number }
  | { type: 'sort-studio' };
