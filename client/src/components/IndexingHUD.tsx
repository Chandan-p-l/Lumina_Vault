import { AlertTriangle, Loader2, Pause, Play, Sparkles } from 'lucide-react';
import { api } from '../api';
import type { VaultStatus } from '../types';

interface IndexingHUDProps {
  status: VaultStatus | null;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function IndexingHUD({ status, onRefresh, onOpenSettings }: IndexingHUDProps) {
  if (!status) return null;
  const { scanProgress, indexingState, counts, hasApiKey } = status;

  const showScan = scanProgress.scanning;
  const showIndex = indexingState.running;
  const hasPending = counts.pending > 0 || counts.errors > 0;

  if (!showScan && !showIndex && !hasPending) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm w-[calc(100vw-2rem)] rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 shadow-2xl p-3.5 space-y-2.5">
      {showScan && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold text-zinc-100">
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              Scanning Folder...
            </span>
            <span className="text-zinc-400">
              {scanProgress.processedFiles} / {scanProgress.totalFiles}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all"
              style={{
                width: `${
                  scanProgress.totalFiles > 0
                    ? Math.round((scanProgress.processedFiles / scanProgress.totalFiles) * 100)
                    : 15
                }%`,
              }}
            />
          </div>
          {scanProgress.currentFile && (
            <p className="text-[11px] text-zinc-400 truncate">{scanProgress.currentFile}</p>
          )}
        </div>
      )}

      {showIndex ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold text-violet-300">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              Gemini AI Indexing
            </span>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">
                {indexingState.processedInRun} / {indexingState.totalPending}
              </span>
              <button
                onClick={() => void api.pauseAiIndexing().then(onRefresh)}
                className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                title="Pause AI Indexing"
              >
                <Pause className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{
                width: `${
                  indexingState.totalPending > 0
                    ? Math.round(
                        (indexingState.processedInRun / indexingState.totalPending) * 100
                      )
                    : 10
                }%`,
              }}
            />
          </div>
          {indexingState.currentFilename && (
            <p className="text-[11px] text-zinc-400 truncate">
              Analyzing: {indexingState.currentFilename}
            </p>
          )}
        </div>
      ) : (
        hasPending &&
        !showScan && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                {counts.errors > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                {counts.pending > 0
                  ? `${counts.pending} items ready for Gemini AI`
                  : `${counts.errors} items failed AI indexing`}
              </p>
              {indexingState.lastError && (
                <p className="text-[11px] text-rose-400 truncate">{indexingState.lastError}</p>
              )}
            </div>
            {hasApiKey ? (
              <button
                onClick={() =>
                  void api.startAiIndexing(counts.pending === 0 && counts.errors > 0).then(onRefresh)
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                <Play className="w-3 h-3" />
                {counts.pending > 0 ? 'Index AI' : 'Retry'}
              </button>
            ) : (
              <button
                onClick={onOpenSettings}
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 text-xs font-semibold shrink-0 cursor-pointer"
              >
                Add Key
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
