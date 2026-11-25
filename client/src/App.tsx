import { useCallback, useEffect, useState } from 'react';
import { FolderTree, X } from 'lucide-react';
import { api } from './api';
import { FolderPickerModal } from './components/FolderPickerModal';
import { IndexingHUD } from './components/IndexingHUD';
import { Lightbox } from './components/Lightbox';
import { MediaGrid } from './components/MediaGrid';
import { SearchHeader } from './components/SearchHeader';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { SortStudio } from './components/SortStudio';
import type { FolderItem, MediaItem, NavSection, VaultStatus } from './types';

export function App() {
  const [nav, setNav] = useState<NavSection>({ type: 'all' });
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search state
  const [query, setQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [aiVerify, setAiVerify] = useState(true);
  const [usedAiVerify, setUsedAiVerify] = useState(false);

  // Filters
  const [mediaType, setMediaType] = useState<'all' | 'photo' | 'video'>('all');
  const [sortBy, setSortBy] = useState('date_desc');

  // Selection & Modals
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchMeta = useCallback(async () => {
    try {
      const [statusRes, foldersRes] = await Promise.all([api.getStatus(), api.getFolders()]);
      setStatus(statusRes);
      setFolders(foldersRes.folders);
    } catch {
      // ignore transient errors
    }
  }, []);

  const fetchGallery = useCallback(async () => {
    if (nav.type === 'sort-studio') return;
    setLoading(true);
    try {
      const res = await api.getMedia({
        mediaType,
        sortBy,
        folderId: nav.type === 'folder' ? nav.folderId : null,
        category: nav.type === 'category' ? nav.category : null,
        year: nav.type === 'timeline' ? nav.year : null,
        month: nav.type === 'timeline' ? nav.month ?? null : null,
        favorite: nav.type === 'favorites',
        view: nav.type === 'duplicates' ? 'duplicates' : undefined,
        limit: 300,
      });
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [nav, mediaType, sortBy]);

  useEffect(() => {
    void fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    if (!isSearchActive && nav.type !== 'sort-studio') {
      void fetchGallery();
    }
  }, [fetchGallery, isSearchActive, nav.type]);

  // Poll status while scanning or AI indexing is running
  useEffect(() => {
    const active = status?.scanProgress.scanning || status?.indexingState.running;
    const interval = setInterval(
      () => {
        void fetchMeta();
        if (active && !isSearchActive && nav.type !== 'sort-studio') {
          void fetchGallery();
        }
      },
      active ? 1800 : 8000
    );
    return () => clearInterval(interval);
  }, [
    status?.scanProgress.scanning,
    status?.indexingState.running,
    fetchMeta,
    fetchGallery,
    isSearchActive,
    nav.type,
  ]);

  const runSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) {
      setIsSearchActive(false);
      return;
    }
    if (nav.type === 'sort-studio') {
      setNav({ type: 'all' });
    }
    setSearching(true);
    setIsSearchActive(true);
    try {
      const res = await api.searchMedia({
        query: q,
        mediaType,
        folderId: nav.type === 'folder' ? nav.folderId : null,
        category: nav.type === 'category' ? nav.category : null,
        year: nav.type === 'timeline' ? nav.year : null,
        month: nav.type === 'timeline' ? nav.month ?? null : null,
        favoriteOnly: nav.type === 'favorites',
        aiVerify,
      });
      setItems(res.items);
      setUsedAiVerify(res.usedAiVerify);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setIsSearchActive(false);
    setUsedAiVerify(false);
  };

  const handleToggleFavorite = async (id: number) => {
    const res = await api.toggleFavorite(id);
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, favorite: res.favorite } : m))
    );
    if (lightboxItem?.id === id) {
      setLightboxItem((prev) => (prev ? { ...prev, favorite: res.favorite } : null));
    }
    void fetchMeta();
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getSectionHeader = (): { title: string; subtitle: string } => {
    switch (nav.type) {
      case 'all':
        return {
          title: 'All Photos & Videos',
          subtitle: `${status?.counts.photos ?? 0} photos • ${status?.counts.videos ?? 0} videos`,
        };
      case 'favorites':
        return { title: 'Favorites', subtitle: 'Your starred photos and videos' };
      case 'duplicates':
        return {
          title: 'Potential Duplicates',
          subtitle: 'Files sharing identical content hashes',
        };
      case 'folder':
        return { title: nav.name, subtitle: 'Connected folder library' };
      case 'category':
        return { title: nav.category, subtitle: 'Auto-organized by Gemini AI' };
      case 'timeline':
        return {
          title: nav.month ? `${nav.year} — Month ${nav.month}` : `${nav.year}`,
          subtitle: 'Chronological timeline',
        };
      case 'sort-studio':
        return {
          title: 'Sort & Organize Studio',
          subtitle: 'Preview and organize files into clean folders',
        };
    }
  };

  const headerInfo = getSectionHeader();

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 flex">
      <Sidebar
        active={nav}
        onSelect={(section) => {
          setNav(section);
          if (isSearchActive && section.type !== 'sort-studio') {
            setIsSearchActive(false);
            setQuery('');
          }
        }}
        folders={folders}
        status={status}
        onOpenConnectModal={() => setConnectOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRescanFolder={(id) => {
          void api.rescanFolder(id).then(fetchMeta);
        }}
        onToggleAutoOrganize={(folder) => {
          const next = folder.auto_organize !== 1;
          void api
            .updateFolderSettings(folder.id, { autoOrganize: next, watchEnabled: next })
            .then(fetchMeta);
        }}
        onOrganizeFolderNow={(id) => {
          void api.organizeFolderNow(id).then(() => {
            void fetchMeta();
            void fetchGallery();
          });
        }}
        onRemoveFolder={(id) => {
          void api.removeFolder(id).then(() => {
            if (nav.type === 'folder' && nav.folderId === id) {
              setNav({ type: 'all' });
            }
            void fetchMeta();
            void fetchGallery();
          });
        }}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900/40">
        <SearchHeader
          query={query}
          onQueryChange={setQuery}
          onSearchSubmit={runSearch}
          onClearSearch={clearSearch}
          searching={searching}
          isSearchActive={isSearchActive}
          aiVerify={aiVerify}
          onToggleAiVerify={() => setAiVerify((v) => !v)}
          mediaType={mediaType}
          onMediaTypeChange={setMediaType}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          title={headerInfo.title}
          subtitle={headerInfo.subtitle}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          resultCount={items.length}
          usedAiVerify={usedAiVerify}
        />

        {selectedIds.size > 0 && nav.type !== 'sort-studio' && (
          <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-2xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-between text-xs">
            <span className="font-medium text-violet-200">
              {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNav({ type: 'sort-studio' })}
                className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold cursor-pointer"
              >
                <FolderTree className="w-3.5 h-3.5" />
                Sort Selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-1 rounded-lg hover:bg-violet-500/20 text-violet-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {nav.type === 'sort-studio' ? (
          <SortStudio
            folders={folders}
            selectedMediaIds={Array.from(selectedIds)}
            onSortCompleted={() => {
              void fetchMeta();
              void fetchGallery();
            }}
          />
        ) : (
          <MediaGrid
            items={items}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onOpenLightbox={setLightboxItem}
            onToggleFavorite={handleToggleFavorite}
            isSearchActive={isSearchActive}
            loading={loading || searching}
            onOpenConnectModal={() => setConnectOpen(true)}
          />
        )}
      </main>

      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          items={items}
          onClose={() => setLightboxItem(null)}
          onSelectItem={setLightboxItem}
          onToggleFavorite={handleToggleFavorite}
          onItemUpdated={(updated) => {
            setItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
            setLightboxItem(updated);
            void fetchMeta();
          }}
          onSearchTag={(tag) => {
            setQuery(tag);
            void runSearch(tag);
          }}
        />
      )}

      <FolderPickerModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => {
          void fetchMeta();
          void fetchGallery();
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => void fetchMeta()}
      />

      <IndexingHUD
        status={status}
        onRefresh={() => void fetchMeta()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  );
}

export default App;
