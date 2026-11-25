import { Film, FolderPlus, FolderTree, Heart, Image as ImageIcon, Layers } from 'lucide-react';
import type { NavSection } from '../types';

interface FloatingDockProps {
  activeNav: NavSection;
  onSelectNav: (nav: NavSection) => void;
  mediaType: 'all' | 'photo' | 'video';
  onMediaTypeChange: (t: 'all' | 'photo' | 'video') => void;
  onOpenConnect: () => void;
}

export function FloatingDock({
  activeNav,
  onSelectNav,
  mediaType,
  onMediaTypeChange,
  onOpenConnect,
}: FloatingDockProps) {
  const pillClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
      active
        ? 'bg-white text-zinc-950 font-semibold'
        : 'text-zinc-300 hover:text-white hover:bg-white/10'
    }`;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[95vw]">
      <div className="flex items-center gap-1 p-1.5 rounded-full bg-[#111317]/95 backdrop-blur-md border border-white/15 shadow-2xl shadow-black/70 overflow-x-auto">
        <button
          onClick={() => {
            onSelectNav({ type: 'all' });
            onMediaTypeChange('all');
          }}
          className={pillClass(activeNav.type === 'all' && mediaType === 'all')}
        >
          <Layers className="w-3.5 h-3.5" />
          All
        </button>

        <button
          onClick={() => {
            if (activeNav.type === 'sort-studio') onSelectNav({ type: 'all' });
            onMediaTypeChange('photo');
          }}
          className={pillClass(mediaType === 'photo' && activeNav.type !== 'sort-studio')}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          Photos
        </button>

        <button
          onClick={() => {
            if (activeNav.type === 'sort-studio') onSelectNav({ type: 'all' });
            onMediaTypeChange('video');
          }}
          className={pillClass(mediaType === 'video' && activeNav.type !== 'sort-studio')}
        >
          <Film className="w-3.5 h-3.5" />
          Videos
        </button>

        <button
          onClick={() => onSelectNav({ type: 'favorites' })}
          className={pillClass(activeNav.type === 'favorites')}
        >
          <Heart className="w-3.5 h-3.5" />
          Favorites
        </button>

        <button
          onClick={() => onSelectNav({ type: 'sort-studio' })}
          className={pillClass(activeNav.type === 'sort-studio')}
        >
          <FolderTree className="w-3.5 h-3.5" />
          Sort Studio
        </button>

        <button
          onClick={onOpenConnect}
          title="Connect Any Folder"
          className="ml-1 flex items-center justify-center w-8 h-8 rounded-full bg-[#b8f34d] hover:bg-[#c8f76c] text-zinc-950 font-bold transition-transform duration-150 hover:scale-105 active:scale-95 shrink-0 cursor-pointer"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
