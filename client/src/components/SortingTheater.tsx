import { useEffect, useMemo, useState } from 'react';
import { Check, Folder, Film, X } from 'lucide-react';
import type { MediaItem, SortPreset } from '../types';

export interface ActiveSortVisual {
  title: string;
  mode: 'copy' | 'move';
  preset: SortPreset;
  targetRoot: string;
  sampleItems: MediaItem[];
  plannedFolders: Array<{ folder: string; count: number; sampleThumbs: string[] }>;
}

interface SortingTheaterProps {
  session: ActiveSortVisual;
  realProgress?: {
    sorting: boolean;
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
  } | null;
  onClose: () => void;
}

/**
 * Low-overhead, rAF-paced visual sorting presentation:
 * Shows all media gathered in the center, then visually materializes folders
 * and sorts thumbnails into them using GPU-only transforms while the real
 * mkdir + file moves execute in the background.
 */
export function SortingTheater({ session, realProgress, onClose }: SortingTheaterProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'center' | 'mkdir' | 'sorting' | 'done'>('center');

  // Build ordered folder targets (preferring real folders if already reported, merged with planned)
  const folders = useMemo(() => {
    const map = new Map<string, { folder: string; count: number; thumbs: string[] }>();
    for (const p of session.plannedFolders) {
      map.set(p.folder, { folder: p.folder, count: p.count, thumbs: p.sampleThumbs });
    }
    if (realProgress?.createdFolders) {
      for (const rf of realProgress.createdFolders) {
        if (!map.has(rf)) {
          map.set(rf, { folder: rf, count: 1, thumbs: [] });
        }
      }
    }
    if (realProgress?.recentMoves) {
      for (const mv of realProgress.recentMoves) {
        const entry = map.get(mv.toFolder);
        if (entry && mv.thumbUrl && entry.thumbs.length < 4 && !entry.thumbs.includes(mv.thumbUrl)) {
          entry.thumbs.push(mv.thumbUrl);
        }
      }
    }
    return Array.from(map.values()).slice(0, 12);
  }, [session.plannedFolders, realProgress]);

  const centerItems = useMemo(() => session.sampleItems.slice(0, 18), [session.sampleItems]);

  // Smooth rAF timeline progression for the presentation (independent of disk speed so it always looks fluid)
  useEffect(() => {
    let rafId = 0;
    const start = performance.now();
    const totalCenterMs = 650;
    const totalMkdirMs = 1350;
    const totalItems = Math.max(1, centerItems.length);
    const perItemMs = 130;

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed < totalCenterMs) {
        setPhase('center');
        setStepIndex(0);
      } else if (elapsed < totalMkdirMs) {
        setPhase('mkdir');
        setStepIndex(0);
      } else {
        const sortElapsed = elapsed - totalMkdirMs;
        const sortedCount = Math.min(totalItems, Math.floor(sortElapsed / perItemMs) + 1);
        setStepIndex(sortedCount);
        if (sortedCount >= totalItems && !realProgress?.sorting) {
          setPhase('done');
          return;
        }
        setPhase('sorting');
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [centerItems.length, realProgress?.sorting]);

  const realTotal = realProgress?.totalFiles || session.sampleItems.length;
  const realDone = realProgress?.sorting ? realProgress.processedFiles : realTotal;

  return (
    <div className="fixed inset-0 z-50 bg-[#070809]/96 flex flex-col justify-between p-4 sm:p-8 overflow-y-auto studio-grid-bg">
      {/* Top Bar */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-400">
            {phase === 'center' && '01 / Gathering Media'}
            {phase === 'mkdir' && '02 / Creating Directory Structure'}
            {phase === 'sorting' && `03 / ${session.mode === 'move' ? 'Moving' : 'Copying'} Into Folders`}
            {phase === 'done' && 'Complete / Organized On Disk'}
          </p>
          <h2 className="font-display text-lg sm:text-xl font-semibold text-white mt-0.5">
            {session.title}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-300 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10">
            {realDone} / {realTotal} files
          </span>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 text-zinc-200 cursor-pointer"
            title="Close presentation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center Stage: Clustered Media Mosaic -> Folders Materializing */}
      <div className="max-w-6xl w-full mx-auto flex-1 flex flex-col items-center justify-center py-6 gap-8">
        {/* Central Media Cluster */}
        <div className="relative w-full max-w-3xl flex flex-col items-center">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 max-w-2xl">
            {centerItems.map((item, idx) => {
              const isSortedAway = idx < stepIndex;
              return (
                <div
                  key={item.id}
                  style={{
                    transition:
                      'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease',
                    transform: isSortedAway
                      ? 'translate3d(0, 48px, 0) scale3d(0.45, 0.45, 1)'
                      : 'translate3d(0, 0, 0) scale3d(1, 1, 1)',
                    opacity: isSortedAway ? 0 : 1,
                  }}
                  className="relative w-16 h-20 sm:w-20 sm:h-24 rounded-xl overflow-hidden bg-[#121418] border border-white/15 shadow-lg shrink-0"
                >
                  {item.thumbUrl ? (
                    <img
                      src={item.thumbUrl}
                      alt={item.filename}
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 p-1">
                      {item.filename}
                    </div>
                  )}
                  {item.mediaType === 'video' && (
                    <span className="absolute bottom-1 right-1 p-0.5 rounded bg-black/75 text-white">
                      <Film className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {phase === 'done' && (
            <div className="mt-2 px-4 py-1.5 rounded-full bg-[#b8f34d]/15 border border-[#b8f34d]/40 text-[#b8f34d] text-xs font-medium flex items-center gap-2">
              <Check className="w-3.5 h-3.5" />
              All {realTotal} photos &amp; videos organized into {folders.length} folders
            </div>
          )}
        </div>

        {/* Generated Destination Folders Grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {folders.map((f, idx) => {
            const visible = phase !== 'center';
            const assignedCount =
              phase === 'done'
                ? f.count
                : Math.min(
                    f.count,
                    Math.max(
                      0,
                      Math.round((stepIndex / Math.max(1, centerItems.length)) * f.count)
                    )
                  );

            return (
              <div
                key={f.folder}
                style={{
                  transition:
                    'transform 450ms cubic-bezier(0.22, 1, 0.36, 1), opacity 380ms ease',
                  transitionDelay: `${Math.min(idx * 55, 350)}ms`,
                  transform: visible
                    ? 'translate3d(0, 0, 0) scale3d(1, 1, 1)'
                    : 'translate3d(0, 18px, 0) scale3d(0.95, 0.95, 1)',
                  opacity: visible ? 1 : 0,
                }}
                className="p-3.5 rounded-2xl bg-[#101216] border border-white/10 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Folder className="w-4 h-4 text-[#b8f34d] shrink-0" />
                    <span className="font-mono text-xs text-zinc-100 truncate">{f.folder}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-[11px] font-mono text-zinc-200 shrink-0">
                    {assignedCount}
                  </span>
                </div>

                {/* Mini stacked thumbnails inside folder */}
                <div className="flex items-center gap-1.5 h-11">
                  {f.thumbs.slice(0, 4).map((thumb, tIdx) => {
                    const showThumb =
                      phase === 'done' ||
                      (phase === 'sorting' && stepIndex >= idx + tIdx + 1);
                    return (
                      <div
                        key={thumb + tIdx}
                        style={{
                          transition: 'opacity 300ms ease, transform 300ms ease',
                          opacity: showThumb ? 1 : 0.15,
                          transform: showThumb
                            ? 'translate3d(0,0,0) scale3d(1,1,1)'
                            : 'translate3d(0,-6px,0) scale3d(0.88,0.88,1)',
                        }}
                        className="w-11 h-11 rounded-lg overflow-hidden bg-zinc-900 border border-white/10"
                      >
                        <img
                          src={thumb}
                          alt=""
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    );
                  })}
                  {f.thumbs.length === 0 && (
                    <span className="text-[11px] font-mono text-zinc-500">mkdir {f.folder}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-xs font-mono text-zinc-500 truncate max-w-md">
          Target: {session.targetRoot}
        </span>

        <button
          onClick={onClose}
          className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            phase === 'done'
              ? 'bg-[#b8f34d] hover:bg-[#c8f76c] text-zinc-950'
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          {phase === 'done' ? 'View Sorted Library' : 'Continue in Background'}
        </button>
      </div>
    </div>
  );
}
