import { useEffect, useRef } from 'react';
import {
  Eye,
  FolderPlus,
  Loader2,
  Menu,
  Search,
  X,
} from 'lucide-react';

interface SearchHeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSearchSubmit: (q?: string) => void;
  onClearSearch: () => void;
  searching: boolean;
  isSearchActive: boolean;
  aiVerify: boolean;
  onToggleAiVerify: () => void;
  sortBy: string;
  onSortByChange: (s: string) => void;
  title: string;
  subtitle: string;
  onOpenMobileMenu: () => void;
  onOpenConnect: () => void;
  resultCount: number;
  usedAiVerify?: boolean;
}

const EXAMPLE_QUERIES = [
  'sitting with dog',
  'sunset at beach',
  'food on table',
  'night lights',
];

export function SearchHeader({
  query,
  onQueryChange,
  onSearchSubmit,
  onClearSearch,
  searching,
  isSearchActive,
  aiVerify,
  onToggleAiVerify,
  sortBy,
  onSortByChange,
  title,
  subtitle,
  onOpenMobileMenu,
  onOpenConnect,
  resultCount,
  usedAiVerify,
}: SearchHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-[#070809]/92 border-b border-white/[0.07] px-4 sm:px-6 py-3 space-y-2.5">
      {/* Top Bar: Solterra-inspired minimal command bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-full bg-white/[0.06] border border-white/10 text-zinc-200 cursor-pointer"
        >
          <Menu className="w-4 h-4" />
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
          className="relative flex-1 flex items-center"
        >
          <div className="absolute left-3.5 flex items-center pointer-events-none">
            {searching ? (
              <Loader2 className="w-4 h-4 text-zinc-200 animate-spin" />
            ) : (
              <Search className="w-4 h-4 text-zinc-400" />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder='Search moments: "find me a photo where I am sitting with dog"...'
            className="w-full pl-10 pr-44 py-2 rounded-full bg-[#111317] border border-white/10 focus:border-white/40 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors"
          />

          <div className="absolute right-1.5 flex items-center gap-1">
            {query && (
              <button
                type="button"
                onClick={onClearSearch}
                className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onToggleAiVerify}
              title="Visually verify exact poses and scenes"
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                aiVerify
                  ? 'bg-white/15 text-white border-white/30'
                  : 'bg-white/[0.04] text-zinc-400 border-white/10 hover:text-zinc-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              Visual Verify
            </button>

            <button
              type="submit"
              disabled={searching}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              Find
            </button>
          </div>
        </form>

        <button
          onClick={onOpenConnect}
          className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#b8f34d] hover:bg-[#c8f76c] text-zinc-950 text-xs font-bold tracking-wide transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] shrink-0 cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          Connect Folder
        </button>
      </div>

      {/* Context Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="font-display font-semibold text-sm text-zinc-100 truncate">
            {isSearchActive ? `Results for "${query}"` : title}
          </h2>
          <span className="text-xs text-zinc-500 truncate">
            {isSearchActive
              ? `${resultCount} match${resultCount === 1 ? '' : 'es'}${
                  usedAiVerify ? ' • Verified by Gemini' : ''
                }`
              : subtitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isSearchActive && (
            <div className="hidden xl:flex items-center gap-1.5">
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    onQueryChange(ex);
                    onSearchSubmit(ex);
                  }}
                  className="px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] text-zinc-300 transition-colors cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {!isSearchActive && (
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value)}
              className="px-3 py-1 rounded-full bg-[#111317] border border-white/10 text-xs text-zinc-300 outline-none focus:border-[#b8f34d]/60"
            >
              <option value="date_desc">Newest First</option>
              <option value="date_asc">Oldest First</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="size_desc">Largest First</option>
            </select>
          )}
        </div>
      </div>
    </header>
  );
}
