import { useEffect, useRef } from 'react';
import {
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Menu,
  Search,
  Sparkles,
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
  mediaType: 'all' | 'photo' | 'video';
  onMediaTypeChange: (t: 'all' | 'photo' | 'video') => void;
  sortBy: string;
  onSortByChange: (s: string) => void;
  title: string;
  subtitle: string;
  onOpenMobileMenu: () => void;
  resultCount: number;
  usedAiVerify?: boolean;
}

const EXAMPLE_QUERIES = [
  'sitting with dog',
  'sunset at beach',
  'food on table',
  'selfie smiling',
  'night lights city',
  'receipt or document',
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
  mediaType,
  onMediaTypeChange,
  sortBy,
  onSortByChange,
  title,
  subtitle,
  onOpenMobileMenu,
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
    <header className="sticky top-0 z-30 bg-zinc-950/85 backdrop-blur-xl border-b border-zinc-800/80 px-4 sm:px-6 py-3.5 space-y-3">
      {/* Top Row: Menu + Hero AI Search Bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300"
        >
          <Menu className="w-5 h-5" />
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
              <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 text-violet-400" />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder='Ask Gemini: "find me a photo where I am sitting with dog"...'
            className="w-full pl-10 pr-44 py-2.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-all"
          />

          <div className="absolute right-2 flex items-center gap-1.5">
            {query && (
              <button
                type="button"
                onClick={onClearSearch}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onToggleAiVerify}
              title="Use Gemini Vision to visually verify top search candidates for exact pose & scene match"
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                aiVerify
                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                  : 'bg-zinc-800/80 text-zinc-400 border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Deep Verify
            </button>

            <button
              type="submit"
              disabled={searching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              Search
            </button>
          </div>
        </form>
      </div>

      {/* Bottom Row: Section Title + Media Type Pills + Example Prompts */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <h2 className="font-display font-semibold text-base text-zinc-100 truncate">
              {isSearchActive ? `AI Search: "${query}"` : title}
            </h2>
            <p className="text-xs text-zinc-400 truncate">
              {isSearchActive
                ? `${resultCount} match${resultCount === 1 ? '' : 'es'} found${
                    usedAiVerify ? ' • Visually verified by Gemini' : ''
                  }`
                : subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Quick Suggestion Chips when idle */}
          {!isSearchActive && (
            <div className="hidden xl:flex items-center gap-1.5 mr-2">
              <span className="text-[11px] text-zinc-500">Try:</span>
              {EXAMPLE_QUERIES.slice(0, 3).map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    onQueryChange(ex);
                    onSearchSubmit(ex);
                  }}
                  className="px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Media Type Filter */}
          <div className="inline-flex rounded-xl bg-zinc-900 p-0.5 border border-zinc-800">
            {(
              [
                { id: 'all', label: 'All', icon: Layers },
                { id: 'photo', label: 'Photos', icon: ImageIcon },
                { id: 'video', label: 'Videos', icon: Film },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = mediaType === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onMediaTypeChange(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    active
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {!isSearchActive && (
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 outline-none focus:border-violet-500/60"
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
