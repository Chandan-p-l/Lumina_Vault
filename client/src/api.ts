import type {
  BrowseResponse,
  FolderItem,
  MediaItem,
  SettingsData,
  SortHistoryItem,
  SortPlanResult,
  SortPreset,
  VaultStatus,
} from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: options?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getStatus: () => request<VaultStatus>('/api/status'),

  browseFs: (path?: string) =>
    request<BrowseResponse>(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  getFolders: () => request<{ folders: FolderItem[] }>('/api/folders'),

  connectFolder: (payload: {
    path: string;
    autoOrganize?: boolean;
    organizePreset?: SortPreset;
    organizeTarget?: string | null;
    watchEnabled?: boolean;
  }) =>
    request<{ folder: FolderItem }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateFolderSettings: (
    id: number,
    payload: {
      autoOrganize?: boolean;
      organizePreset?: SortPreset;
      organizeTarget?: string | null;
      watchEnabled?: boolean;
    }
  ) =>
    request<{ folder: FolderItem }>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  organizeFolderNow: (id: number) =>
    request<{ operationId: string; processed: number; targetRoot: string }>(
      `/api/folders/${id}/organize`,
      { method: 'POST' }
    ),

  rescanFolder: (id: number) =>
    request<{ ok: boolean }>(`/api/folders/${id}/rescan`, { method: 'POST' }),

  removeFolder: (id: number) =>
    request<{ ok: boolean }>(`/api/folders/${id}`, { method: 'DELETE' }),

  uploadFolderFiles: (files: File[], batchName: string) => {
    const form = new FormData();
    form.append('batchName', batchName);
    for (const file of files) {
      form.append('files', file);
    }
    return request<{ folderId: number; folderPath: string }>('/api/folders/upload', {
      method: 'POST',
      body: form,
    });
  },

  getMedia: (params: {
    mediaType?: 'all' | 'photo' | 'video';
    folderId?: number | null;
    category?: string | null;
    year?: number | null;
    month?: number | null;
    favorite?: boolean;
    view?: 'duplicates';
    sortBy?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.mediaType) qs.set('mediaType', params.mediaType);
    if (params.folderId) qs.set('folderId', String(params.folderId));
    if (params.category) qs.set('category', params.category);
    if (params.year) qs.set('year', String(params.year));
    if (params.month) qs.set('month', String(params.month));
    if (params.favorite) qs.set('favorite', 'true');
    if (params.view) qs.set('view', params.view);
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: MediaItem[]; total: number }>(`/api/media?${qs.toString()}`);
  },

  searchMedia: (payload: {
    query: string;
    mediaType?: 'all' | 'photo' | 'video';
    folderId?: number | null;
    category?: string | null;
    year?: number | null;
    month?: number | null;
    favoriteOnly?: boolean;
    aiVerify?: boolean;
  }) =>
    request<{ items: MediaItem[]; usedAiVerify: boolean; usedEmbeddings: boolean }>('/api/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleFavorite: (id: number) =>
    request<{ favorite: boolean }>(`/api/media/${id}/favorite`, { method: 'POST' }),

  reindexMedia: (id: number) =>
    request<{ item: MediaItem }>(`/api/media/${id}/reindex`, { method: 'POST' }),

  getSimilar: (id: number) => request<{ items: MediaItem[] }>(`/api/media/${id}/similar`),

  startAiIndexing: (includeErrors = false) =>
    request<{ ok: boolean }>('/api/ai/index/start', {
      method: 'POST',
      body: JSON.stringify({ includeErrors }),
    }),

  pauseAiIndexing: () => request<{ ok: boolean }>('/api/ai/index/pause', { method: 'POST' }),

  planSort: (payload: {
    preset: SortPreset;
    targetRoot: string;
    folderId?: number | null;
    mediaIds?: number[];
  }) =>
    request<SortPlanResult>('/api/sort/plan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeSort: (payload: {
    preset: SortPreset;
    targetRoot: string;
    mode: 'copy' | 'move';
    folderId?: number | null;
    mediaIds?: number[];
  }) =>
    request<{
      operationId: string;
      processed: number;
      failed: Array<{ fromPath: string; error: string }>;
      targetRoot: string;
    }>('/api/sort/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSortHistory: () => request<{ history: SortHistoryItem[] }>('/api/sort/history'),

  undoSort: (id: string) =>
    request<{ reverted: number; failed: number }>(`/api/sort/undo/${id}`, { method: 'POST' }),

  getSettings: () => request<SettingsData>('/api/settings'),

  saveSettings: (payload: Partial<SettingsData> & { apiKey?: string }) =>
    request<SettingsData>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  testSettings: (payload?: { apiKey?: string; apiMode?: string }) =>
    request<{
      ok: boolean;
      mode: 'vertex' | 'gemini' | null;
      visionModel: string;
      embeddingWorking: boolean;
      embeddingModelUsed: string | null;
      message: string;
    }>('/api/settings/test', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
};
