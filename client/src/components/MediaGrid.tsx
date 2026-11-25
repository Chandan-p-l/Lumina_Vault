import { useEffect, useRef, useState } from 'react';
import { Check, Film, Folder, Heart, ImageOff, Images, Layers, Loader2 } from 'lucide-react';
import type { MediaItem } from '../types';

interface MediaGridProps {
  items: MediaItem[];
  totalCount: number;
  viewKey: string;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onOpenLightbox: (item: MediaItem) => void;
  onToggleFavorite: (id: number) => void;
  isSearchActive: boolean;
  isIndexing: boolean;
  loading: boolean;
  onOpenConnectModal: () => void;
}

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MediaGrid({
  items,
  totalCount,
  viewKey,
  selectedIds,
  onToggleSelect,
  onOpenLightbox,
  onToggleFavorite,
  isSearchActive,
  isIndexing,
  loading,
  onOpenConnectModal,
}: MediaGridProps) {
  const [hoveredVideoId, setHoveredVideoId] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [groupMode, setGroupMode] = useState<'auto' | 'category' | 'timeline'>('auto');
  const hoverTimerRef = useRef<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Reset scroll window ONLY when switching view/search/filter, never during live indexing updates
  useEffect(() => {
    setVisibleCount(60);
  }, [viewKey]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || visibleCount >= items.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          requestAnimationFrame(() => {
            setVisibleCount((c) => Math.min(items.length, c + 60));
          });
        }
      },
      { rootMargin: '300px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleCount, items.length]);

  const scheduleVideoHover = (id: number) => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredVideoId(id);
    }, 180);
  };

  const cancelVideoHover = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredVideoId(null);
  };

  if (loading && items.length === 0) {
    return (
      <div className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[4/5] rounded-2xl bg-[#101215] border border-white/[0.06] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#111317] border border-white/10 flex items-center justify-center mb-4">
          <Images className="w-7 h-7 text-zinc-300" />
        </div>
        <h3 className="font-display text-xl font-semibold text-white mb-2">
          {isSearchActive ? 'No matching moments found' : 'No photos or videos in this view'}
        </h3>
        <p className="text-sm text-zinc-400 max-w-md mb-6">
          {isSearchActive
            ? 'Try rephrasing your query, turning on Visual Verify, or letting AI indexing finish.'
            : 'Connect any folder on your computer to automatically sort photos & videos into clean folders and search them in plain English.'}
        </p>
        {!isSearchActive && (
          <button
            onClick={onOpenConnectModal}
            className="px-6 py-2.5 rounded-full bg-[#b8f34d] hover:bg-[#c8f76c] text-zinc-950 text-xs font-bold uppercase tracking-wider transition-transform duration-200 hover:scale-[1.03] cursor-pointer"
          >
            Connect Folder
          </button>
        )}
      </div>
    );
  }

  const effectiveGroupMode =
    groupMode === 'auto' ? (isIndexing ? 'category' : 'timeline') : groupMode;

  const windowedItems = items.slice(0, visibleCount);
  const groups: Array<{ label: string; isPending?: boolean; items: MediaItem[] }> = [];

  if (isSearchActive) {
    groups.push({ label: 'Search Matches', items: windowedItems });
  } else if (effectiveGroupMode === 'category') {
    const catMap = new Map<string, MediaItem[]>();
    const queued: MediaItem[] = [];
    for (const item of items) {
      if (item.aiStatus === 'indexed' && item.aiCategory) {
        const list = catMap.get(item.aiCategory) || [];
        list.push(item);
        catMap.set(item.aiCategory, list);
      } else {
        queued.push(item);
      }
    }

    const sortedCats = Array.from(catMap.entries()).sort((a, b) => b[1].length - a[1].length);
    for (const [cat, list] of sortedCats) {
      groups.push({ label: cat, items: list.slice(0, visibleCount) });
    }
    if (queued.length > 0) {
      groups.push({
        label: isIndexing ? 'Classifying & Sorting Live...' : 'Pending Classification',
        isPending: true,
        items: queued.slice(0, Math.max(24, visibleCount)),
      });
    }
  } else {
    const map = new Map<string, MediaItem[]>();
    for (const item of windowedItems) {
      const dt = new Date(item.capturedAt);
      const label = Number.isNaN(dt.getTime())
        ? `${item.year}`
        : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
      const list = map.get(label) || [];
      list.push(item);
      map.set(label, list);
    }
    for (const [label, list] of map.entries()) {
      groups.push({ label, items: list });
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 pb-32">
      {/* Live View Mode Switcher & Live Indexing Buckets */}
      {!isSearchActive && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            {isIndexing && (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#b8f34d]/15 border border-[#b8f34d]/35 text-[#b8f34d] font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                Live Sorting Into Folders
              </span>
            )}
            <span className="font-mono text-[11px] text-zinc-500">
              Showing {Math.min(visibleCount, items.length)} of {totalCount}
            </span>
          </div>

          <div className="inline-flex rounded-full bg-[#111317] p-0.5 border border-white/10">
            <button
              onClick={() => setGroupMode('category')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                effectiveGroupMode === 'category'
                  ? 'bg-white text-zinc-950 font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Folder className="w-3 h-3" />
              Live Sorted Folders
            </button>
            <button
              onClick={() => setGroupMode('timeline')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                effectiveGroupMode === 'timeline'
                  ? 'bg-white text-zinc-950 font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers className="w-3 h-3" />
              Timeline
            </button>
          </div>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.label} className="space-y-3.5">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 flex items-center gap-2">
              {group.isPending ? (
                <Loader2 className="w-3.5 h-3.5 text-[#b8f34d] animate-spin" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-[#b8f34d]" />
              )}
              {group.label}
            </h3>
            <span className="text-[11px] font-mono text-zinc-500">
              {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3.5">
            {group.items.map((item, idx) => {
              const isSelected = selectedIds.has(item.id);
              const isHoverVideo = hoveredVideoId === item.id && item.mediaType === 'video';
              const isFeatured = !group.isPending && idx === 0 && group.items.length > 5;

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => {
                    if (item.mediaType === 'video') scheduleVideoHover(item.id);
                  }}
                  onMouseLeave={cancelVideoHover}
                  onClick={() => onOpenLightbox(item)}
                  className={`card-reveal perf-card group relative rounded-2xl overflow-hidden bg-[#101216] border transition-colors duration-200 cursor-pointer ${
                    isFeatured ? 'sm:col-span-2 aspect-[16/10]' : 'aspect-[4/5]'
                  } ${
                    isSelected
                      ? 'border-[#b8f34d] ring-2 ring-[#b8f34d]/40'
                      : item.aiStatus === 'processing'
                        ? 'border-[#b8f34d]/60'
                        : 'border-white/[0.07] hover:border-white/25'
                  }`}
                >
                  {isHoverVideo ? (
                    <video
                      src={item.fileUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : item.thumbUrl ? (
                    <img
                      src={item.thumbUrl}
                      alt={item.aiCaption || item.filename}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 p-3">
                      <ImageOff className="w-7 h-7 mb-1" />
                      <span className="text-[11px] truncate max-w-full">{item.filename}</span>
                    </div>
                  )}

                  {/* Subtle top vignette */}
                  <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

                  {/* Top-Left: Select + Category Pill */}
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSelect(item.id);
                        }}
                        className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-opacity duration-150 cursor-pointer ${
                          isSelected
                            ? 'bg-[#b8f34d] border-[#b8f34d] text-zinc-950 opacity-100'
                            : 'bg-black/55 border-white/35 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>

                      {item.aiCategory && (
                        <span className="px-2 py-0.5 rounded-full bg-black/60 border border-white/15 text-[10px] font-medium text-zinc-200 truncate">
                          {item.aiCategory}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {typeof item.score === 'number' && isSearchActive && (
                        <span className="px-2 py-0.5 rounded-full bg-[#b8f34d] text-[10px] font-bold text-zinc-950">
                          {item.score}%
                        </span>
                      )}

                      {item.mediaType === 'video' && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 border border-white/15 text-[10px] font-medium text-zinc-100">
                          <Film className="w-3 h-3 text-[#b8f34d]" />
                          {formatDuration(item.durationSec)}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(item.id);
                        }}
                        className={`p-1.5 rounded-full transition-opacity duration-150 cursor-pointer ${
                          item.favorite
                            ? 'bg-rose-500/90 text-white opacity-100'
                            : 'bg-black/55 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/80'
                        }`}
                      >
                        <Heart className={`w-3 h-3 ${item.favorite ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Bottom Editorial Title & Metadata */}
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/55 to-transparent pointer-events-none">
                    <div className="flex items-end justify-between gap-2">
                      <p className="text-xs font-medium text-zinc-100 line-clamp-2 leading-snug">
                        {isSearchActive && item.matchReason
                          ? item.matchReason
                          : item.aiCaption || item.filename}
                      </p>
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                        {item.year}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {visibleCount < items.length && (
        <div ref={loadMoreRef} className="py-6 flex justify-center">
          <button
            onClick={() => setVisibleCount((c) => Math.min(items.length, c + 60))}
            className="px-5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-zinc-300 cursor-pointer"
          >
            Load more ({items.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
