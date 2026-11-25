import { useState } from 'react';
import {
  Check,
  Film,
  Heart,
  ImageOff,
  Sparkles,
} from 'lucide-react';
import type { MediaItem } from '../types';

interface MediaGridProps {
  items: MediaItem[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onOpenLightbox: (item: MediaItem) => void;
  onToggleFavorite: (id: number) => void;
  isSearchActive: boolean;
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
  selectedIds,
  onToggleSelect,
  onOpenLightbox,
  onToggleFavorite,
  isSearchActive,
  loading,
  onOpenConnectModal,
}: MediaGridProps) {
  const [hoveredVideoId, setHoveredVideoId] = useState<number | null>(null);

  if (loading && items.length === 0) {
    return (
      <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[4/3] rounded-2xl bg-zinc-900/80 border border-zinc-800/60 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
          <Sparkles className="w-8 h-8 text-violet-400" />
        </div>
        <h3 className="font-display text-xl font-semibold text-zinc-100 mb-2">
          {isSearchActive ? 'No matching photos or videos found' : 'Your Lumina Vault is empty'}
        </h3>
        <p className="text-sm text-zinc-400 max-w-md mb-6">
          {isSearchActive
            ? 'Try rephrasing your query, turning on Deep Verify, or making sure AI indexing has finished for your connected folders.'
            : 'Connect any folder on your computer containing photos and videos. Lumina will extract dates, generate fast thumbnails, organize your library, and index everything with Gemini AI.'}
        </p>
        {!isSearchActive && (
          <button
            onClick={onOpenConnectModal}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-violet-600/20 cursor-pointer"
          >
            Connect Your First Folder
          </button>
        )}
      </div>
    );
  }

  // Group items by Year - Month for clean chronological headers when browsing normally
  const groups: Array<{ label: string; items: MediaItem[] }> = [];
  if (isSearchActive) {
    groups.push({ label: 'Search Results', items });
  } else {
    const map = new Map<string, MediaItem[]>();
    for (const item of items) {
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
    <div className="p-4 sm:p-6 space-y-8 pb-28">
      {groups.map((group) => (
        <section key={group.label} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-zinc-300 tracking-wide">
              {group.label}
              <span className="ml-2 text-xs font-normal text-zinc-500">
                ({group.items.length})
              </span>
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {group.items.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const isHoverVideo = hoveredVideoId === item.id && item.mediaType === 'video';

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => {
                    if (item.mediaType === 'video') setHoveredVideoId(item.id);
                  }}
                  onMouseLeave={() => {
                    if (hoveredVideoId === item.id) setHoveredVideoId(null);
                  }}
                  onClick={() => onOpenLightbox(item)}
                  className={`group relative aspect-square rounded-2xl overflow-hidden bg-zinc-900 border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-violet-500 ring-2 ring-violet-500/40 scale-[0.98]'
                      : 'border-zinc-800/70 hover:border-zinc-600'
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
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 p-3">
                      <ImageOff className="w-7 h-7 mb-1" />
                      <span className="text-[11px] truncate max-w-full">{item.filename}</span>
                    </div>
                  )}

                  {/* Top gradient overlay */}
                  <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/65 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                  {/* Select checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(item.id);
                    }}
                    className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-full border flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-violet-600 border-violet-400 text-white opacity-100'
                        : 'bg-black/45 border-white/40 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>

                  {/* Top-Right Badges: Favorite + Video Duration + AI Score */}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                    {typeof item.score === 'number' && isSearchActive && (
                      <span className="px-2 py-0.5 rounded-full bg-violet-600/90 backdrop-blur-md text-[11px] font-semibold text-white shadow">
                        {item.score}% match
                      </span>
                    )}

                    {item.mediaType === 'video' && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-[11px] font-medium text-zinc-100">
                        <Film className="w-3 h-3 text-violet-300" />
                        {formatDuration(item.durationSec)}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(item.id);
                      }}
                      className={`p-1.5 rounded-full backdrop-blur-md transition-all cursor-pointer ${
                        item.favorite
                          ? 'bg-rose-500/85 text-white opacity-100'
                          : 'bg-black/45 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/70'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${item.favorite ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {/* Bottom AI Caption / Match Reason */}
                  <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {item.aiCategory && (
                      <span className="inline-block px-1.5 py-0.5 mb-1 rounded bg-white/15 text-[10px] font-medium text-zinc-100 backdrop-blur-sm">
                        {item.aiCategory}
                      </span>
                    )}
                    <p className="text-[11px] text-zinc-100 line-clamp-2 leading-snug">
                      {isSearchActive && item.matchReason
                        ? item.matchReason
                        : item.aiCaption || item.filename}
                    </p>
                  </div>

                  {/* Small AI status dot when indexed */}
                  {item.aiStatus === 'indexed' && !isSearchActive && (
                    <span
                      title="Indexed by Gemini AI"
                      className="absolute bottom-2 right-2 w-2 h-2 rounded-full bg-emerald-400/80 ring-2 ring-black/40 group-hover:opacity-0 transition-opacity"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
