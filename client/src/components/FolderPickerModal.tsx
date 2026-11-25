import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { BrowseResponse, SortPreset } from '../types';

declare global {
  interface Window {
    luminaDesktop?: {
      isDesktop: boolean;
      platform: string;
      pickFolder: () => Promise<string | null>;
    };
  }
}

interface FolderPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: (info?: { folderId: number; autoOrganize: boolean; preset: SortPreset; path: string }) => void;
}

export function FolderPickerModal({ open, onClose, onConnected }: FolderPickerModalProps) {
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [autoOrganize, setAutoOrganize] = useState(true);
  const [organizePreset, setOrganizePreset] = useState<SortPreset>('media-type');
  const [customPattern, setCustomPattern] = useState('{type}/{year}/{month_name}');
  const [customPrompt, setCustomPrompt] = useState('');
  const [parsingPrompt, setParsingPrompt] = useState(false);
  const [separateScreenshots, setSeparateScreenshots] = useState(true);
  const [watchEnabled, setWatchEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDesktop = Boolean(window.luminaDesktop?.isDesktop);

  const loadPath = async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.browseFs(target);
      setBrowse(data);
      setManualPath(data.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to browse directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadPath();
    }
  }, [open]);

  if (!open) return null;

  const handleConnect = async (pathToConnect: string) => {
    setConnecting(true);
    setError(null);
    try {
      const res = await api.connectFolder({
        path: pathToConnect,
        autoOrganize,
        organizePreset,
        watchEnabled: watchEnabled || autoOrganize,
        organizeRule: autoOrganize
          ? {
              preset: organizePreset,
              folderPattern: organizePreset === 'custom' ? customPattern : undefined,
              separateScreenshots,
            }
          : undefined,
      });
      onConnected({
        folderId: res.folder.id,
        autoOrganize,
        preset: organizePreset,
        path: res.folder.path,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect folder');
    } finally {
      setConnecting(false);
    }
  };

  const handleNativePick = async () => {
    const picked = await window.luminaDesktop?.pickFolder();
    if (picked) {
      await loadPath(picked);
    }
  };

  const handleBrowserFolderUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const files = Array.from(fileList);
      const firstRel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
      const batchName = firstRel ? firstRel.split('/')[0] : `Import_${Date.now()}`;
      await api.uploadFolderFiles(files, batchName);
      onConnected();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import folder');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-500/15 text-violet-300">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-base text-zinc-100">
                Connect Any Folder
              </h2>
              <p className="text-xs text-zinc-400">
                Pick a folder on Linux or Windows — optionally auto-create & move into Photos/ & Videos/
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Direct Path Input + Native Desktop Picker */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadPath(manualPath);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/home/user/Pictures or C:\Users\Name\Pictures"
              className="flex-1 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer"
            >
              Open
            </button>
            {isDesktop && (
              <button
                type="button"
                onClick={() => void handleNativePick()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-xs font-medium text-violet-200 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse OS
              </button>
            )}
          </form>

          {/* Shortcuts */}
          {browse && (
            <div className="flex flex-wrap gap-1.5">
              {browse.shortcuts.map((s) => (
                <button
                  key={s.path}
                  onClick={() => void loadPath(s.path)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors cursor-pointer ${
                    browse.currentPath === s.path
                      ? 'bg-violet-500/15 border-violet-500/40 text-violet-200'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <HardDrive className="w-3 h-3" />
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Directory Browser */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {browse?.parentPath && (
                  <button
                    onClick={() => void loadPath(browse.parentPath!)}
                    className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-300 cursor-pointer"
                    title="Go up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="truncate font-mono text-zinc-300">
                  {browse?.currentPath || '...'}
                </span>
              </div>
              {browse && (
                <span className="text-zinc-500 shrink-0 ml-2">
                  {browse.mediaCountEstimate} media in folder
                </span>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800/60">
              {loading ? (
                <div className="p-6 flex items-center justify-center text-xs text-zinc-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reading directory...
                </div>
              ) : browse?.directories.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500">
                  No subfolders here. You can connect this folder directly!
                </div>
              ) : (
                browse?.directories.map((dir) => (
                  <div
                    key={dir.path}
                    className="flex items-center justify-between px-3.5 py-2 hover:bg-zinc-800/60 transition-colors"
                  >
                    <button
                      onClick={() => void loadPath(dir.path)}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left text-sm text-zinc-200 cursor-pointer"
                    >
                      <Folder className="w-4 h-4 text-amber-400/80 shrink-0" />
                      <span className="truncate">{dir.name}</span>
                      {dir.hasChildren && (
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      )}
                    </button>
                    <button
                      onClick={() => void handleConnect(dir.path)}
                      disabled={connecting}
                      className="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/30 text-violet-300 text-xs font-medium cursor-pointer"
                    >
                      Select
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Auto-Organize & Watch Options */}
          <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/25 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <FolderTree className="w-3.5 h-3.5" />
                  Auto-Create Folders &amp; Move Photos/Videos
                </p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Automatically creates separate <code>Photos/</code> &amp; <code>Videos/</code>{' '}
                  subfolders and moves files into them as they are scanned or dropped in.
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoOrganize}
                onChange={(e) => setAutoOrganize(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-emerald-500 cursor-pointer"
              />
            </div>

            {autoOrganize && (
              <div className="space-y-2.5 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <select
                    value={organizePreset}
                    onChange={(e) => setOrganizePreset(e.target.value as SortPreset)}
                    className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 outline-none"
                  >
                    <option value="media-type">Photos &amp; Videos / Year / Month</option>
                    <option value="media-type-category">
                      Photos &amp; Videos / AI Category / Year
                    </option>
                    <option value="year-month">Year / Month / Photos &amp; Videos</option>
                    <option value="custom">Custom Folder Pattern...</option>
                  </select>
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={watchEnabled}
                      onChange={(e) => setWatchEnabled(e.target.checked)}
                      className="accent-emerald-500"
                    />
                    Watch live for newly added files
                  </label>
                </div>

                {organizePreset === 'custom' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder='Describe in English: "separate by category and year"'
                        className="flex-1 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        disabled={parsingPrompt || !customPrompt.trim()}
                        onClick={async () => {
                          setParsingPrompt(true);
                          try {
                            const res = await api.parseSortPrompt(customPrompt);
                            setCustomPattern(res.folderPattern);
                            setSeparateScreenshots(res.separateScreenshots);
                          } finally {
                            setParsingPrompt(false);
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-medium cursor-pointer"
                      >
                        {parsingPrompt ? 'Parsing...' : 'Use Prompt'}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={customPattern}
                      onChange={(e) => setCustomPattern(e.target.value)}
                      placeholder="{type}/{category}/{year}/{month_name}"
                      className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-100 outline-none focus:border-emerald-500"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={separateScreenshots}
                    onChange={(e) => setSeparateScreenshots(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Put screenshots into their own Screenshots/ folder
                </label>
              </div>
            )}
          </div>

          {/* Browser Folder Picker Fallback */}
          {!isDesktop && (
            <div className="p-3.5 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <UploadCloud className="w-5 h-5 text-zinc-400 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-zinc-200">
                    Or pick a folder via browser upload
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Copies selected folder&apos;s photos &amp; videos into Lumina&apos;s local vault
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is supported in modern Chromium/Firefox/Safari
                webkitdirectory=""
                className="hidden"
                onChange={(e) => void handleBrowserFolderUpload(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 shrink-0 cursor-pointer"
              >
                {uploading ? 'Importing...' : 'Choose Folder'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500 truncate">
            Selected: <strong className="text-zinc-300">{browse?.currentPath}</strong>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              disabled={!browse || connecting}
              onClick={() => browse && void handleConnect(browse.currentPath)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              {connecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {autoOrganize ? 'Connect & Auto-Organize' : 'Connect This Folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
