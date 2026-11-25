import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Folder,
  FolderTree,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';
import type { FolderItem, SortHistoryItem, SortPlanResult, SortPreset } from '../types';

interface SortStudioProps {
  folders: FolderItem[];
  selectedMediaIds: number[];
  onSortCompleted: () => void;
}

const PRESETS: Array<{ id: SortPreset; title: string; example: string }> = [
  {
    id: 'media-type',
    title: 'Photos & Videos / Year / Month',
    example: 'Photos/2025/03_March/IMG_1024.jpg & Videos/2025/03_March/clip.mp4',
  },
  {
    id: 'media-type-category',
    title: 'Photos & Videos / AI Category / Year',
    example: 'Photos/Pets & Animals/2025/dog.jpg & Videos/Travel/2025/trip.mp4',
  },
  {
    id: 'year-month',
    title: 'Year / Month / Photos & Videos',
    example: '2025/03_March/Photos/IMG_1024.jpg',
  },
  {
    id: 'year-category',
    title: 'Year / AI Smart Category',
    example: '2025/Pets & Animals/dog_park.jpg',
  },
  {
    id: 'category-year',
    title: 'AI Smart Category / Year',
    example: 'Pets & Animals/2025/dog_park.jpg',
  },
];

export function SortStudio({ folders, selectedMediaIds, onSortCompleted }: SortStudioProps) {
  const [preset, setPreset] = useState<SortPreset>('media-type');
  const [mode, setMode] = useState<'copy' | 'move'>('move');
  const [sourceFolderId, setSourceFolderId] = useState<string>(
    selectedMediaIds.length > 0 ? 'selected' : 'all'
  );
  const [targetRoot, setTargetRoot] = useState('');
  const [plan, setPlan] = useState<SortPlanResult | null>(null);
  const [history, setHistory] = useState<SortHistoryItem[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetRoot && folders.length > 0) {
      setTargetRoot(folders[0].path);
    }
    void loadHistory();
  }, [folders]);

  const loadHistory = async () => {
    try {
      const res = await api.getSortHistory();
      setHistory(res.history);
    } catch {
      // ignore
    }
  };

  const handlePreview = async () => {
    if (!targetRoot.trim()) {
      setError('Please enter a destination folder path.');
      return;
    }
    setLoadingPlan(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.planSort({
        preset,
        targetRoot,
        folderId:
          sourceFolderId === 'all' || sourceFolderId === 'selected'
            ? null
            : Number(sourceFolderId),
        mediaIds: sourceFolderId === 'selected' ? selectedMediaIds : undefined,
      });
      setPlan(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build sort preview');
    } finally {
      setLoadingPlan(false);
    }
  };

  const handleExecute = async () => {
    if (!targetRoot.trim()) return;
    setExecuting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.executeSort({
        preset,
        targetRoot,
        mode,
        folderId:
          sourceFolderId === 'all' || sourceFolderId === 'selected'
            ? null
            : Number(sourceFolderId),
        mediaIds: sourceFolderId === 'selected' ? selectedMediaIds : undefined,
      });
      setMessage(
        `Successfully ${mode === 'copy' ? 'copied' : 'moved'} ${res.processed} files into ${res.targetRoot}${
          res.failed.length > 0 ? ` (${res.failed.length} failed)` : ''
        }.`
      );
      setPlan(null);
      await loadHistory();
      onSortCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sort execution failed');
    } finally {
      setExecuting(false);
    }
  };

  const handleUndo = async (id: string) => {
    try {
      const res = await api.undoSort(id);
      setMessage(`Reverted ${res.reverted} file operations.`);
      await loadHistory();
      onSortCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 pb-28">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-100 flex items-center gap-2.5">
            <FolderTree className="w-5 h-5 text-emerald-400" />
            Smart Sort & Folder Organizer Studio
          </h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Preview exact folder structure before sorting. Supports safe Copy mode, Move mode, and 1-click Undo.
          </p>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 p-5 rounded-3xl bg-zinc-900/70 border border-zinc-800 space-y-5">
          {/* Preset Picker */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              1. Organization Structure
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPreset(p.id);
                    setPlan(null);
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    preset === p.id
                      ? 'bg-violet-500/15 border-violet-500/50 text-zinc-100'
                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <p className="text-sm font-semibold">{p.title}</p>
                  <p className="text-[11px] font-mono text-zinc-400 mt-1 truncate">{p.example}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Source & Destination */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                2. Source Scope
              </label>
              <select
                value={sourceFolderId}
                onChange={(e) => {
                  setSourceFolderId(e.target.value);
                  setPlan(null);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 outline-none focus:border-violet-500"
              >
                <option value="all">All Connected Folders</option>
                {selectedMediaIds.length > 0 && (
                  <option value="selected">
                    Selected Items Only ({selectedMediaIds.length})
                  </option>
                )}
                {folders.map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {f.name} ({f.item_count ?? 0} files)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                3. Operation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('copy')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    mode === 'copy'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Copy (Safest)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('move')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    mode === 'move'
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Move Files
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              4. Destination Root Folder
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={targetRoot}
                onChange={(e) => {
                  setTargetRoot(e.target.value);
                  setPlan(null);
                }}
                placeholder="/home/user/Pictures/Sorted"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 font-mono outline-none focus:border-violet-500"
              />
              <button
                onClick={handlePreview}
                disabled={loadingPlan}
                className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loadingPlan && <Loader2 className="w-4 h-4 animate-spin" />}
                Preview Sort Plan
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}
          {message && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {message}
            </div>
          )}

          {/* Dry-Run Preview Tree */}
          {plan && (
            <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">
                    Dry-Run Preview: {plan.totalFiles} files to organize
                  </h4>
                  <p className="text-xs text-zinc-500">
                    {plan.unchangedFiles} already in matching location • {plan.folderTree.length}{' '}
                    output folders
                  </p>
                </div>

                {plan.totalFiles > 0 && (
                  <button
                    onClick={handleExecute}
                    disabled={executing}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-lg cursor-pointer"
                  >
                    {executing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Apply {mode === 'copy' ? 'Copy' : 'Move'} ({plan.totalFiles} files)
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {plan.folderTree.map((node) => (
                  <div
                    key={node.folder}
                    className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="w-4 h-4 text-amber-400/80 shrink-0" />
                      <span className="font-mono text-xs text-zinc-200 truncate">{node.folder}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400 shrink-0">
                      <span className="truncate max-w-[220px]">{node.sampleFiles.join(', ')}</span>
                      <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 font-semibold">
                        {node.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sort History & Undo Sidebar */}
        <div className="p-5 rounded-3xl bg-zinc-900/70 border border-zinc-800 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="font-display text-sm font-semibold text-zinc-100">
              Sort History & Undo
            </h3>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No physical sort operations yet. Run a sort preview and apply it to see undoable history here.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="p-3 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200 capitalize">
                      {h.mode} • {h.fileCount} files
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {new Date(h.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-zinc-400 truncate" title={h.targetRoot}>
                    {h.targetRoot}
                  </p>
                  <div className="pt-1">
                    {h.reverted ? (
                      <span className="text-[11px] text-zinc-500 italic">Reverted</span>
                    ) : (
                      <button
                        onClick={() => void handleUndo(h.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Undo Sort
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
