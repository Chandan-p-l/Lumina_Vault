import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Folder,
  FolderOpen,
  FolderTree,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '../api';
import type {
  DuplicatePolicy,
  FilenamePattern,
  FolderItem,
  MediaItem,
  SortHistoryItem,
  SortPlanResult,
  SortPreset,
} from '../types';
import type { ActiveSortVisual } from './SortingTheater';

interface SortStudioProps {
  folders: FolderItem[];
  allMedia: MediaItem[];
  selectedMediaIds: number[];
  onStartVisualSort: (session: ActiveSortVisual) => void;
  onSortCompleted: () => void;
}

const PRESETS: Array<{ id: SortPreset; title: string; pattern: string; example: string }> = [
  {
    id: 'media-type',
    title: 'Photos & Videos / Year / Month',
    pattern: '{type}/{year}/{month_name}',
    example: 'Photos/2026/11_November/IMG_1024.jpg',
  },
  {
    id: 'media-type-category',
    title: 'Photos & Videos / AI Category / Year',
    pattern: '{type}/{category}/{year}',
    example: 'Photos/Pets & Animals/2026/dog.jpg',
  },
  {
    id: 'year-month',
    title: 'Year / Month / Photos & Videos',
    pattern: '{year}/{month_name}/{type}',
    example: '2026/11_November/Photos/IMG_1024.jpg',
  },
  {
    id: 'year-category',
    title: 'Year / AI Smart Category',
    pattern: '{year}/{category}',
    example: '2026/Pets & Animals/dog_park.jpg',
  },
  {
    id: 'category-year',
    title: 'AI Smart Category / Year',
    pattern: '{category}/{year}',
    example: 'Pets & Animals/2026/dog_park.jpg',
  },
];

const FOLDER_TOKENS: Array<{ token: string; label: string; sample: string }> = [
  { token: '{type}', label: 'Photos / Videos', sample: 'Photos' },
  { token: '{year}', label: 'Year', sample: '2026' },
  { token: '{month_name}', label: 'Month Name', sample: '11_November' },
  { token: '{month}', label: 'Month (01-12)', sample: '11' },
  { token: '{day}', label: 'Full Date', sample: '2026-11-25' },
  { token: '{category}', label: 'AI Category', sample: 'Pets & Animals' },
  { token: '{camera}', label: 'Camera Model', sample: 'iPhone 15' },
  { token: '{orientation}', label: 'Orientation', sample: 'Landscape' },
  { token: '{resolution}', label: 'Resolution', sample: '4K & Ultra-HD' },
  { token: '{extension}', label: 'File Format', sample: 'JPG' },
  { token: '{source}', label: 'Source Folder', sample: 'CameraRoll' },
];

function renderSamplePath(pattern: string, filenamePattern: FilenamePattern): string {
  const map: Record<string, string> = {};
  for (const t of FOLDER_TOKENS) {
    map[t.token] = t.sample;
  }
  const folder = (pattern || '{type}/{year}/{month_name}')
    .split(/[/\\]+/)
    .filter(Boolean)
    .map((seg) =>
      seg.replace(/\{[a-z_]+\}/gi, (m) => map[m.toLowerCase()] || m)
    )
    .join('/');

  const file =
    filenamePattern === 'date_original'
      ? '2026-11-25_IMG_1024.jpg'
      : filenamePattern === 'date_caption'
        ? '2026-11-25_14-30_sitting-with-dog.jpg'
        : filenamePattern === 'sequence'
          ? '0001_2026-11-25.jpg'
          : 'IMG_1024.jpg';

  return `${folder}/${file}`;
}

export function SortStudio({
  folders,
  allMedia,
  selectedMediaIds,
  onStartVisualSort,
  onSortCompleted,
}: SortStudioProps) {
  const [preset, setPreset] = useState<SortPreset>('media-type');
  const [sortPrompt, setSortPrompt] = useState('');
  const [parsingPrompt, setParsingPrompt] = useState(false);
  const [promptExplanation, setPromptExplanation] = useState<string | null>(null);
  const [folderPattern, setFolderPattern] = useState('{type}/{year}/{month_name}');
  const [filenamePattern, setFilenamePattern] = useState<FilenamePattern>('original');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'photo' | 'video'>('all');
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>('rename');
  const [separateScreenshots, setSeparateScreenshots] = useState(true);
  const [classifyFirst, setClassifyFirst] = useState(true);

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

  const isDesktop = Boolean(window.luminaDesktop?.isDesktop);

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

  const liveExample = useMemo(
    () => renderSamplePath(folderPattern, filenamePattern),
    [folderPattern, filenamePattern]
  );

  const appendToken = (token: string) => {
    setPreset('custom');
    setPlan(null);
    setFolderPattern((prev) => {
      const clean = prev.replace(/[/\\]+$/, '');
      return clean ? `${clean}/${token}` : token;
    });
  };

  const handleParsePrompt = async (overridePrompt?: string) => {
    const text = (overridePrompt ?? sortPrompt).trim();
    if (!text) return;
    setParsingPrompt(true);
    setError(null);
    setPromptExplanation(null);
    try {
      const parsed = await api.parseSortPrompt(text);
      setPreset('custom');
      setFolderPattern(parsed.folderPattern);
      setFilenamePattern(parsed.filenamePattern);
      setMediaFilter(parsed.mediaFilter);
      setDuplicatePolicy(parsed.duplicatePolicy);
      setSeparateScreenshots(parsed.separateScreenshots);
      setClassifyFirst(parsed.classifyFirst);
      setMode(parsed.mode);
      setPromptExplanation(
        `${parsed.explanation}${parsed.usedGemini ? ' (Gemini)' : ' (Local rule parser)'}`
      );
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse sorting prompt');
    } finally {
      setParsingPrompt(false);
    }
  };

  const handleBrowseDest = async () => {
    if (isDesktop && window.luminaDesktop) {
      const picked = await window.luminaDesktop.pickFolder();
      if (picked) {
        setTargetRoot(picked);
        setPlan(null);
      }
      return;
    }
    try {
      const res = await api.browseFs(targetRoot || undefined);
      setTargetRoot(res.currentPath);
      setPlan(null);
    } catch {
      // ignore
    }
  };

  const handlePreview = async () => {
    if (!targetRoot.trim()) {
      setError('Please enter or select a destination folder path.');
      return;
    }
    setLoadingPlan(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.planSort({
        preset,
        targetRoot,
        folderPattern,
        filenamePattern,
        mediaFilter,
        duplicatePolicy,
        separateScreenshots,
        classifyFirst,
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

    if (plan && plan.items.length > 0) {
      const thumbById = new Map(allMedia.map((m) => [m.id, m.thumbUrl]));
      const sampleItems = plan.items
        .slice(0, 18)
        .map((it) => allMedia.find((m) => m.id === it.mediaId))
        .filter((m): m is MediaItem => Boolean(m));
      const plannedFolders = plan.folderTree.map((node) => ({
        folder: node.folder,
        count: node.count,
        sampleThumbs: plan.items
          .filter((it) => it.relativeTarget.startsWith(node.folder))
          .map((it) => thumbById.get(it.mediaId))
          .filter((t): t is string => Boolean(t))
          .slice(0, 4),
      }));

      onStartVisualSort({
        title: `Organizing ${plan.totalFiles} files (${mode === 'move' ? 'Move' : 'Copy'})`,
        mode,
        preset,
        targetRoot: plan.targetRoot,
        sampleItems: sampleItems.length > 0 ? sampleItems : allMedia.slice(0, 18),
        plannedFolders,
      });
    }

    try {
      const res = await api.executeSort({
        preset,
        targetRoot,
        mode,
        folderPattern,
        filenamePattern,
        mediaFilter,
        duplicatePolicy,
        separateScreenshots,
        classifyFirst,
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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 pb-32">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-100 flex items-center gap-2.5">
            <FolderTree className="w-5 h-5 text-[#b8f34d]" />
            Sort &amp; Custom Parameters Studio
          </h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Choose a quick structure or build your own folder hierarchy, file naming, duplicate rules, and filters.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 p-5 rounded-3xl bg-[#101216] border border-white/10 space-y-5">
          {/* 0. Natural Language Sort Prompt */}
          <div className="p-4 rounded-2xl bg-[#090a0d] border border-[#b8f34d]/30 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#b8f34d]">
                Describe How You Want To Sort (Plain English)
              </label>
              <span className="text-[10px] font-mono text-zinc-500">Gemini Parameter Builder</span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleParsePrompt();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={sortPrompt}
                onChange={(e) => setSortPrompt(e.target.value)}
                placeholder='e.g. "Separate photos and videos by year and AI category, rename with date, move duplicates aside"'
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#111317] border border-white/15 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-[#b8f34d]"
              />
              <button
                type="submit"
                disabled={parsingPrompt || !sortPrompt.trim()}
                className="px-4 py-2.5 rounded-xl bg-[#b8f34d] hover:bg-[#c8f76c] disabled:opacity-50 text-zinc-950 text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                {parsingPrompt && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Set Parameters
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              {[
                'Separate photos & videos by year and AI category, rename with date',
                'Group by camera and orientation, put screenshots separate',
                'Sort all 4K videos and photos by month, skip duplicates',
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setSortPrompt(example);
                    void handleParsePrompt(example);
                  }}
                  className="px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-[11px] text-zinc-300 text-left cursor-pointer"
                >
                  {example}
                </button>
              ))}
            </div>

            {promptExplanation && (
              <div className="px-3 py-2 rounded-xl bg-[#b8f34d]/10 border border-[#b8f34d]/30 text-xs text-[#b8f34d]">
                {promptExplanation}
              </div>
            )}
          </div>

          {/* 1. Quick Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              1. Quick Structure Presets
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPreset(p.id);
                    setFolderPattern(p.pattern);
                    setPlan(null);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-colors cursor-pointer ${
                    preset === p.id
                      ? 'bg-[#b8f34d]/15 border-[#b8f34d]/50 text-white'
                      : 'bg-[#090a0d] border-white/10 text-zinc-300 hover:border-white/25'
                  }`}
                >
                  <p className="text-xs font-semibold">{p.title}</p>
                  <p className="text-[11px] font-mono text-zinc-400 mt-1 truncate">{p.example}</p>
                </button>
              ))}
              <button
                onClick={() => {
                  setPreset('custom');
                  setPlan(null);
                }}
                className={`p-3 rounded-2xl border text-left transition-colors cursor-pointer ${
                  preset === 'custom'
                    ? 'bg-[#b8f34d]/15 border-[#b8f34d]/50 text-white'
                    : 'bg-[#090a0d] border-white/10 text-zinc-300 hover:border-white/25'
                }`}
              >
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#b8f34d]" />
                  Custom Parameter Rule
                </p>
                <p className="text-[11px] font-mono text-zinc-400 mt-1 truncate">
                  Design your own hierarchy &amp; rules below
                </p>
              </button>
            </div>
          </div>

          {/* 2. Custom Parameter Builder */}
          <div className="p-4 rounded-2xl bg-[#090a0d] border border-white/10 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#b8f34d]" />
                2. Custom Folder &amp; File Parameters
              </span>
              <button
                type="button"
                onClick={() => {
                  setPreset('custom');
                  setFolderPattern('');
                  setPlan(null);
                }}
                className="text-[11px] text-zinc-400 hover:text-white cursor-pointer"
              >
                Clear Pattern
              </button>
            </div>

            {/* Folder Pattern Input */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-zinc-400">
                Folder Path Template (click tokens below or type custom folders like{' '}
                <code className="text-zinc-200">Archive/{'{year}'}/{'{category}'}</code>)
              </label>
              <input
                type="text"
                value={folderPattern}
                onChange={(e) => {
                  setPreset('custom');
                  setFolderPattern(e.target.value);
                  setPlan(null);
                }}
                placeholder="{type}/{year}/{month_name}/{category}"
                className="w-full px-3.5 py-2 rounded-xl bg-[#111317] border border-white/15 text-xs font-mono text-white outline-none focus:border-[#b8f34d]"
              />
              <p className="text-[11px] font-mono text-[#b8f34d] truncate">
                Example output: {liveExample}
              </p>
            </div>

            {/* Clickable Token Chips */}
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => appendToken(t.token)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] text-zinc-200 cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-[#b8f34d]" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Naming, Media Type Filter, Duplicate Handling */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400">File Naming Rule</label>
                <select
                  value={filenamePattern}
                  onChange={(e) => {
                    setFilenamePattern(e.target.value as FilenamePattern);
                    setPlan(null);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#111317] border border-white/10 text-xs text-zinc-200 outline-none"
                >
                  <option value="original">Keep Original Name</option>
                  <option value="date_original">Date + Original Name</option>
                  <option value="date_caption">Date + AI Description</option>
                  <option value="sequence">Sequential (0001_Date)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400">Include Media</label>
                <select
                  value={mediaFilter}
                  onChange={(e) => {
                    setMediaFilter(e.target.value as 'all' | 'photo' | 'video');
                    setPlan(null);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#111317] border border-white/10 text-xs text-zinc-200 outline-none"
                >
                  <option value="all">All Photos &amp; Videos</option>
                  <option value="photo">Photos Only</option>
                  <option value="video">Videos Only</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400">Duplicate Handling</label>
                <select
                  value={duplicatePolicy}
                  onChange={(e) => {
                    setDuplicatePolicy(e.target.value as DuplicatePolicy);
                    setPlan(null);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#111317] border border-white/10 text-xs text-zinc-200 outline-none"
                >
                  <option value="rename">Keep All (Rename)</option>
                  <option value="separate_folder">Move to _Duplicates/</option>
                  <option value="skip">Skip Exact Duplicates</option>
                </select>
              </div>
            </div>

            {/* Extra Smart Checkboxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#111317] border border-white/10 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={separateScreenshots}
                  onChange={(e) => {
                    setSeparateScreenshots(e.target.checked);
                    setPlan(null);
                  }}
                  className="accent-[#b8f34d]"
                />
                Separate Screenshots into Screenshots/
              </label>

              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#111317] border border-white/10 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={classifyFirst}
                  onChange={(e) => setClassifyFirst(e.target.checked)}
                  className="accent-[#b8f34d]"
                />
                Classify all pending items with AI first
              </label>
            </div>
          </div>

          {/* 3. Source, Mode, Destination */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                3. Source Scope
              </label>
              <select
                value={sourceFolderId}
                onChange={(e) => {
                  setSourceFolderId(e.target.value);
                  setPlan(null);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#090a0d] border border-white/10 text-sm text-zinc-200 outline-none focus:border-[#b8f34d]"
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
                4. Operation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('copy')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                    mode === 'copy'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-[#090a0d] border-white/10 text-zinc-400'
                  }`}
                >
                  Copy (Safest)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('move')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                    mode === 'move'
                      ? 'bg-[#b8f34d]/15 border-[#b8f34d]/50 text-[#b8f34d]'
                      : 'bg-[#090a0d] border-white/10 text-zinc-400'
                  }`}
                >
                  Move Files
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              5. Destination Root Folder
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={targetRoot}
                onChange={(e) => {
                  setTargetRoot(e.target.value);
                  setPlan(null);
                }}
                placeholder="/home/user/Pictures/Sorted or C:\Users\Name\Pictures\Sorted"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#090a0d] border border-white/10 text-sm text-zinc-100 font-mono outline-none focus:border-[#b8f34d]"
              />
              <button
                type="button"
                onClick={() => void handleBrowseDest()}
                className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse
              </button>
              <button
                onClick={() => void handlePreview()}
                disabled={loadingPlan}
                className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
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
            <div className="p-4 rounded-2xl bg-[#090a0d] border border-white/10 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">
                    Dry-Run Preview: {plan.totalFiles} files to organize
                  </h4>
                  <p className="text-xs text-zinc-500">
                    {plan.unchangedFiles} already sorted • {plan.skippedDuplicates} duplicates skipped •{' '}
                    {plan.folderTree.length} output folders
                  </p>
                </div>

                {plan.totalFiles > 0 && (
                  <button
                    onClick={() => void handleExecute()}
                    disabled={executing}
                    className="flex items-center gap-2 px-5 py-2 rounded-full bg-[#b8f34d] hover:bg-[#c8f76c] text-zinc-950 text-xs font-bold shadow-lg cursor-pointer"
                  >
                    {executing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    Apply {mode === 'copy' ? 'Copy' : 'Move'} ({plan.totalFiles} files)
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {plan.folderTree.map((node) => (
                  <div
                    key={node.folder}
                    className="p-2.5 rounded-xl bg-[#111317] border border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="w-4 h-4 text-[#b8f34d] shrink-0" />
                      <span className="font-mono text-xs text-zinc-200 truncate">{node.folder}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400 shrink-0">
                      <span className="truncate max-w-[220px]">{node.sampleFiles.join(', ')}</span>
                      <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-zinc-200 font-semibold">
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
        <div className="p-5 rounded-3xl bg-[#101216] border border-white/10 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#b8f34d]" />
            <h3 className="font-display text-sm font-semibold text-zinc-100">
              Sort History &amp; Undo
            </h3>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No physical sort operations yet. Set your parameters, preview the plan, and apply to see undoable history here.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="p-3 rounded-2xl bg-[#090a0d] border border-white/10 space-y-1.5"
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
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-[11px] text-zinc-200 cursor-pointer"
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
