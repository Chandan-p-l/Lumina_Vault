import { useEffect, useState } from 'react';
import {
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  Heart,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import type { MediaItem } from '../types';

interface LightboxProps {
  item: MediaItem;
  items: MediaItem[];
  onClose: () => void;
  onSelectItem: (item: MediaItem) => void;
  onToggleFavorite: (id: number) => void;
  onItemUpdated: (item: MediaItem) => void;
  onSearchTag: (tag: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function Lightbox({
  item,
  items,
  onClose,
  onSelectItem,
  onToggleFavorite,
  onItemUpdated,
  onSearchTag,
}: LightboxProps) {
  const [zoomed, setZoomed] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [similar, setSimilar] = useState<MediaItem[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const currentIdx = items.findIndex((i) => i.id === item.id);
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < items.length - 1;

  useEffect(() => {
    setZoomed(false);
    setSimilar([]);
    let cancelled = false;
    setLoadingSimilar(true);
    api
      .getSimilar(item.id)
      .then((res) => {
        if (!cancelled) setSimilar(res.items.slice(0, 6));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSimilar(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onSelectItem(items[currentIdx - 1]);
      if (e.key === 'ArrowRight' && hasNext) onSelectItem(items[currentIdx + 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hasPrev, hasNext, currentIdx, items, onSelectItem]);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const res = await api.reindexMedia(item.id);
      onItemUpdated(res.item);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to analyze item');
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col lg:flex-row">
      {/* Main Media Stage */}
      <div className="relative flex-1 flex items-center justify-center p-4 sm:p-8 overflow-hidden select-none">
        {/* Top Controls */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-200 backdrop-blur-md">
            <span className="truncate max-w-[200px] sm:max-w-sm font-medium">{item.filename}</span>
            {currentIdx >= 0 && (
              <span className="text-zinc-500">
                {currentIdx + 1} / {items.length}
              </span>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            {item.mediaType === 'photo' && (
              <button
                onClick={() => setZoomed((z) => !z)}
                className="p-2.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                title={zoomed ? 'Reset zoom' : 'Zoom in'}
              >
                {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={() => onToggleFavorite(item.id)}
              className={`p-2.5 rounded-full border cursor-pointer ${
                item.favorite
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                  : 'bg-zinc-900/80 border-zinc-800 text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Toggle favorite"
            >
              <Heart className={`w-4 h-4 ${item.favorite ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Prev / Next Arrows */}
        {hasPrev && (
          <button
            onClick={() => onSelectItem(items[currentIdx - 1])}
            className="absolute left-3 sm:left-5 z-20 p-3 rounded-full bg-zinc-900/75 border border-zinc-800 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {hasNext && (
          <button
            onClick={() => onSelectItem(items[currentIdx + 1])}
            className="absolute right-3 sm:right-5 z-20 p-3 rounded-full bg-zinc-900/75 border border-zinc-800 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {/* Media Content */}
        {item.mediaType === 'video' ? (
          <video
            key={item.id}
            src={item.fileUrl}
            controls
            autoPlay
            className="max-w-full max-h-[82vh] rounded-xl shadow-2xl outline-none"
          />
        ) : (
          <img
            src={item.fileUrl}
            alt={item.aiCaption || item.filename}
            onClick={() => setZoomed((z) => !z)}
            className={`max-h-[85vh] rounded-xl shadow-2xl transition-transform duration-300 cursor-zoom-in ${
              zoomed ? 'scale-150 cursor-zoom-out' : 'max-w-full object-contain'
            }`}
          />
        )}
      </div>

      {/* Right Inspector Sidebar */}
      <aside className="w-full lg:w-96 bg-zinc-950 border-t lg:border-t-0 lg:border-l border-zinc-800/80 overflow-y-auto p-5 space-y-6 max-h-[42vh] lg:max-h-full">
        {/* Gemini AI Analysis Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-300">
              <Sparkles className="w-3.5 h-3.5" />
              Gemini Vision Insights
            </h3>
            <button
              onClick={handleReindex}
              disabled={reindexing}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 disabled:opacity-50 cursor-pointer"
            >
              {reindexing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {item.aiStatus === 'indexed' ? 'Re-analyze' : 'Analyze Now'}
            </button>
          </div>

          {item.aiStatus === 'indexed' ? (
            <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
              {item.aiCategory && (
                <span className="inline-block px-2.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-[11px] font-medium text-violet-300">
                  {item.aiCategory}
                </span>
              )}
              <p className="text-sm text-zinc-200 leading-relaxed">{item.aiCaption}</p>

              {item.aiPeoplePets && (
                <div className="text-xs text-zinc-400">
                  <span className="text-zinc-500 font-medium">Subjects: </span>
                  {item.aiPeoplePets}
                </div>
              )}

              {item.aiTextOcr && (
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 text-xs text-zinc-300">
                  <span className="text-zinc-500 font-medium block mb-0.5">Detected Text:</span>
                  {item.aiTextOcr}
                </div>
              )}

              {item.aiTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {item.aiTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        onSearchTag(tag);
                        onClose();
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-800/90 hover:bg-violet-500/20 hover:text-violet-200 text-[11px] text-zinc-300 transition-colors cursor-pointer"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400">
              {item.aiStatus === 'error'
                ? `AI indexing error: ${item.aiError || 'Unknown error'}`
                : 'Not indexed by Gemini AI yet. Click "Analyze Now" or start background indexing.'}
            </div>
          )}
        </div>

        {/* File & EXIF Details */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Details & EXIF
          </h4>
          <div className="space-y-2 text-xs text-zinc-300">
            <div className="flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {new Date(item.capturedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <FileText className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <div>
                <p>
                  {item.width && item.height ? `${item.width} × ${item.height} • ` : ''}
                  {formatBytes(item.sizeBytes)}
                </p>
                <p className="text-zinc-500 uppercase">{item.ext.replace('.', '')}</p>
              </div>
            </div>

            {(item.cameraMake || item.cameraModel) && (
              <div className="flex items-start gap-2.5">
                <Camera className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <p>{[item.cameraMake, item.cameraModel].filter(Boolean).join(' ')}</p>
              </div>
            )}

            {item.gpsLat !== null && item.gpsLng !== null && (
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <p>
                  {item.gpsLat.toFixed(4)}, {item.gpsLng.toFixed(4)}
                </p>
              </div>
            )}

            <div className="flex items-start gap-2.5">
              <Folder className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <p className="text-zinc-400 break-all">{item.path}</p>
            </div>
          </div>
        </div>

        {/* Similar Photos */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Visually Similar
          </h4>
          {loadingSimilar ? (
            <div className="text-xs text-zinc-500">Finding similar moments...</div>
          ) : similar.length === 0 ? (
            <div className="text-xs text-zinc-500">
              Index more photos with Gemini AI to discover similar scenes.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {similar.map((sim) => (
                <button
                  key={sim.id}
                  onClick={() => onSelectItem(sim)}
                  className="aspect-square rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-violet-500 transition-colors cursor-pointer"
                >
                  {sim.thumbUrl && (
                    <img
                      src={sim.thumbUrl}
                      alt={sim.filename}
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
