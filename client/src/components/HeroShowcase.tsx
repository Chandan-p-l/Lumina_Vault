import { useState } from 'react';
import { ArrowUpRight, FolderPlus, Play } from 'lucide-react';
import { useFrameCarousel } from '../hooks/useFrameEffects';
import type { MediaItem, VaultStatus } from '../types';

interface HeroShowcaseProps {
  items: MediaItem[];
  status: VaultStatus | null;
  onOpenConnect: () => void;
  onSelectCategory: (category: string) => void;
  onOpenLightbox: (item: MediaItem) => void;
}

/**
 * Inspired directly by the uploaded reference designs:
 * - Clean monochrome editorial wordmark & serif+sans pairing ("Find the photo that reflects your ideas")
 * - Central photo/video mosaic cluster when media is loaded (Reference 2 & 3)
 * - Zero generic AI sparkle icons
 */
export function HeroShowcase({
  items,
  status,
  onOpenConnect,
  onSelectCategory,
  onOpenLightbox,
}: HeroShowcaseProps) {
  const [paused, setPaused] = useState(false);

  const mosaicItems = items.filter((m) => m.thumbUrl).slice(0, 14);
  const photoHighlights = items
    .filter((m) => m.mediaType === 'photo' && m.thumbUrl)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite))
    .slice(0, 5);

  const slides =
    photoHighlights.length > 0
      ? photoHighlights.map((item) => ({
          id: item.id,
          eyebrow: item.aiCategory
            ? `${item.aiCategory.toUpperCase()} / ${item.year}`
            : `ARCHIVE / ${item.year}`,
          headline: (item.aiCategory || `${item.year} HIGHLIGHTS`).toUpperCase(),
          caption: item.aiCaption || item.filename,
          imageUrl: item.fileUrl,
          item,
        }))
      : [
          {
            id: -1,
            eyebrow: 'PERSONAL MEDIA ARCHIVE',
            headline: '2026 VAULT',
            caption:
              'Connect any folder to gather your photos and videos in the center, organize them into clean folders, and search by natural language.',
            imageUrl: null,
            item: null,
          },
        ];

  const { index, setIndex, progress } = useFrameCarousel(slides.length, 6500, paused);
  const active = slides[index] || slides[0];

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative mx-4 sm:mx-6 mt-4 rounded-3xl overflow-hidden border border-white/10 bg-[#0b0c0e] shadow-2xl min-h-[280px] sm:min-h-[320px] flex flex-col justify-between"
    >
      {/* Subtle Background Layer */}
      {active.imageUrl ? (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            key={active.id}
            src={active.imageUrl}
            alt={active.headline}
            decoding="async"
            className="w-full h-full object-cover opacity-35 hero-ken-burns transition-opacity duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070809] via-[#070809]/65 to-[#070809]/45" />
        </div>
      ) : (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.05), transparent 60%), linear-gradient(180deg, #0d0e11 0%, #070809 100%)',
          }}
        />
      )}

      {/* Top Editorial Line */}
      <div className="relative z-10 px-6 pt-5 flex items-center justify-between text-[10px] font-mono tracking-[0.22em] uppercase text-zinc-400">
        <span>{active.eyebrow}</span>
        <span>
          {status?.counts.total ?? 0} MEDIA • {status?.counts.indexed ?? 0} INDEXED
        </span>
      </div>

      {/* Center Stage: Mosaic Cluster around Bold Editorial Headline (References 2 & 3) */}
      <div className="relative z-10 px-6 py-5 flex flex-col items-center text-center">
        {mosaicItems.length > 0 && (
          <div className="mb-4 flex items-center justify-center flex-wrap gap-1.5 max-w-2xl">
            {mosaicItems.slice(0, 10).map((m) => (
              <button
                key={m.id}
                onClick={() => onOpenLightbox(m)}
                className="w-11 h-14 sm:w-13 sm:h-16 rounded-lg overflow-hidden border border-white/15 bg-zinc-900 transition-transform duration-200 hover:scale-110 hover:z-10 cursor-pointer"
                title={m.filename}
              >
                <img
                  src={m.thumbUrl!}
                  alt={m.filename}
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        <h2 className="font-display font-extrabold text-3xl sm:text-5xl tracking-[0.08em] text-white uppercase max-w-4xl truncate">
          {active.headline}
        </h2>

        <p className="mt-2 text-xs sm:text-sm text-zinc-300 max-w-xl line-clamp-2 font-light">
          {active.caption}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          {active.item ? (
            <>
              <button
                onClick={() => onOpenLightbox(active.item!)}
                className="flex items-center gap-2 px-5 py-2 rounded-full border border-white/25 bg-white/10 hover:bg-white/20 text-xs font-semibold tracking-wider uppercase text-white transition-transform duration-150 hover:scale-[1.03] cursor-pointer"
              >
                <Play className="w-3 h-3 fill-current" />
                Open
              </button>
              {active.item.aiCategory && (
                <button
                  onClick={() => onSelectCategory(active.item!.aiCategory!)}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-bold tracking-wider uppercase transition-transform duration-150 hover:scale-[1.03] cursor-pointer"
                >
                  {active.item.aiCategory}
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          ) : (
            <button
              onClick={onOpenConnect}
              className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-bold tracking-wider uppercase transition-transform duration-150 hover:scale-[1.03] cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              Connect Folder
            </button>
          )}
        </div>
      </div>

      {/* Bottom Slide Pagination & Frame Progress */}
      <div className="relative z-10 px-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                i === index ? 'w-7 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/60'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-zinc-400">
          {slides.length > 1 && (
            <div className="w-16 h-0.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full bg-white origin-left"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          )}
          <span className="hidden sm:inline">Find the photo that reflects your idea</span>
        </div>
      </div>
    </section>
  );
}
