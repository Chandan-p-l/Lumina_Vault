import { useCallback, useEffect, useState } from 'react';
import { FolderTree, X } from 'lucide-react';
import { api } from './api';
import { FloatingDock } from './components/FloatingDock';
import { FolderPickerModal } from './components/FolderPickerModal';
import { HeroShowcase } from './components/HeroShowcase';
import { IndexingHUD } from './components/IndexingHUD';
import { Lightbox } from './components/Lightbox';
import { MediaGrid } from './components/MediaGrid';
import { SearchHeader } from './components/SearchHeader';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { SortingTheater, type ActiveSortVisual } from './components/SortingTheater';
import { SortStudio } from './components/SortStudio';
import type { FolderItem, MediaItem, NavSection, SortPreset, VaultStatus } from './types';

export function App() {
  const [nav, setNav] = useState<NavSection>({ type: 'all' });
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [aiVerify, setAiVerify] = useState(true);
  const [usedAiVerify, setUsedAiVerify] = useState(false);

  const [mediaType, setMediaType] = useState<'all' | 'photo' | 'video'>('all');
  const [sortBy, setSortBy] = useState('date_desc');

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [visualSort, setVisualSort] = useState<ActiveSortVisual | null>(null);

  const fetchMeta = useCallback(async () => {
    try {
      const [statusRes, foldersRes] = await Promise.all([api.getStatus(), api.getFolders()]);
      setStatus(statusRes);
      setFolders(foldersRes.folders);
    } catch {
      // ignore transient errors
    }
  }, []);

  const fetchGallery = useCallback(
    async (silent = false) => {
      if (nav.type === 'sort-studio') return;
      if (!silent) setLoading(true);
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
          limit: 500,
        });
        setItems(res.items);
        setTotalItems(res.total);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [nav, mediaType, sortBy]
  );

  useEffect(() => {
    void fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    if (!isSearchActive && nav.type !== 'sort-studio') {
      void fetchGallery();
    }
  }, [fetchGallery, isSearchActive, nav.type]);

  useEffect(() => {
    const active =
      status?.scanProgress.scanning ||
      status?.indexingState.running ||
      status?.sortProgress?.sorting ||
      Boolean(visualSort);
    const interval = setInterval(
      () => {
        void fetchMeta();
        if (active && !isSearchActive && nav.type !== 'sort-studio') {
          void fetchGallery(true);
        }
      },
      active ? 1200 : 8000
    );
    return () => clearInterval(interval);
  }, [
    status?.scanProgress.scanning,
    status?.indexingState.running,
    status?.sortProgress?.sorting,
    visualSort,
    fetchMeta,
    fetchGallery,
    isSearchActive,
    nav.type,
  ]);

  const runSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) {
      setIsSearchActive(false);
      setSearchWarning(null);
      return;
    }
    if (nav.type === 'sort-studio') {
      setNav({ type: 'all' });
    }
    setSearching(true);
    setIsSearchActive(true);
    setSearchWarning(null);
    try {
      // Search across the entire vault (all sorted folders & timeline)
      const res = await api.searchMedia({
        query: q,
        mediaType,
        aiVerify,
      });
      setItems(res.items);
      setUsedAiVerify(res.usedAiVerify);
      if (res.warning) {
        setSearchWarning(res.warning);
      } else if (res.items.length === 0 && !res.hasApiKey) {
        setSearchWarning('Add your Gemini API key in Settings to enable visual photo & video search.');
      }
      void fetchMeta();
    } catch (err) {
      setSearchWarning(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setIsSearchActive(false);
    setUsedAiVerify(false);
    setSearchWarning(null);
  };

  const launchVisualFolderOrganize = async (
    folderId: number,
    folderPath: string,
    preset: SortPreset
  ) => {
    try {
      const [mediaRes, planRes] = await Promise.all([
        api.getMedia({ folderId, limit: 60 }),
        api.planSort({ preset, targetRoot: folderPath, folderId }),
      ]);
      const thumbById = new Map(mediaRes.items.map((m) => [m.id, m.thumbUrl]));
      let plannedFolders = planRes.folderTree.map((node) => ({
        folder: node.folder,
        count: node.count,
        sampleThumbs: planRes.items
          .filter((it) => it.relativeTarget.startsWith(node.folder))
          .map((it) => thumbById.get(it.mediaId))
          .filter((t): t is string => Boolean(t))
          .slice(0, 4),
      }));

      // Fallback if background move already completed on disk before modal opened
      if (plannedFolders.length === 0 && mediaRes.items.length > 0) {
        const grouped = new Map<string, { count: number; sampleThumbs: string[] }>();
        for (const m of mediaRes.items) {
          const typeDir = m.mediaType === 'video' ? 'Videos' : 'Photos';
          const key = `${typeDir}/${m.year}`;
          const g = grouped.get(key) || { count: 0, sampleThumbs: [] };
          g.count++;
          if (m.thumbUrl && g.sampleThumbs.length < 4) g.sampleThumbs.push(m.thumbUrl);
          grouped.set(key, g);
        }
        plannedFolders = Array.from(grouped.entries()).map(([folder, info]) => ({
          folder,
          count: info.count,
          sampleThumbs: info.sampleThumbs,
        }));
      }

      if (mediaRes.items.length > 0) {
        setVisualSort({
          title: `Auto-Organizing ${folderPath.split(/[\\/]/).pop() || 'Folder'}`,
          mode: 'move',
          preset,
          targetRoot: folderPath,
          sampleItems: mediaRes.items.slice(0, 18),
          plannedFolders,
        });
      }
    } catch {
      // ignore preview errors
    }
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
        return { title: 'Favorites', subtitle: 'Your starred moments' };
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
          subtitle: 'Preview and move files into separate folders',
        };
    }
  };

  const headerInfo = getSectionHeader();

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#070809] text-zinc-100 flex">
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
          const folder = folders.find((f) => f.id === id);
          if (folder) {
            void launchVisualFolderOrganize(
              folder.id,
              folder.organize_target || folder.path,
              (folder.organize_preset || 'media-type') as SortPreset
            );
          }
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

      <main className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto studio-grid-bg">
        <SearchHeader
          query={query}
          onQueryChange={setQuery}
          onSearchSubmit={runSearch}
          onClearSearch={clearSearch}
          searching={searching}
          isSearchActive={isSearchActive}
          aiVerify={aiVerify}
          onToggleAiVerify={() => setAiVerify((v) => !v)}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          title={headerInfo.title}
          subtitle={headerInfo.subtitle}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenConnect={() => setConnectOpen(true)}
          resultCount={items.length}
          usedAiVerify={usedAiVerify}
        />

        {!isSearchActive && nav.type === 'all' && (
          <HeroShowcase
            items={items}
            status={status}
            onOpenConnect={() => setConnectOpen(true)}
            onSelectCategory={(cat) => setNav({ type: 'category', category: cat })}
            onOpenLightbox={setLightboxItem}
          />
        )}

        {isSearchActive && searchWarning && (
          <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
            <span>{searchWarning}</span>
            {!status?.hasApiKey && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="px-3 py-1 rounded-full bg-amber-400 text-zinc-950 font-semibold shrink-0 cursor-pointer"
              >
                Open Settings
              </button>
            )}
          </div>
        )}

        {selectedIds.size > 0 && nav.type !== 'sort-studio' && (
          <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-full bg-[#b8f34d]/15 border border-[#b8f34d]/35 flex items-center justify-between text-xs">
            <span className="font-semibold text-[#b8f34d]">
              {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNav({ type: 'sort-studio' })}
                className="flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#b8f34d] hover:bg-[#c8f76c] text-zinc-950 font-bold cursor-pointer"
              >
                <FolderTree className="w-3.5 h-3.5" />
                Sort Selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-1 rounded-full hover:bg-white/10 text-zinc-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {nav.type === 'sort-studio' ? (
          <SortStudio
            folders={folders}
            allMedia={items}
            selectedMediaIds={Array.from(selectedIds)}
            onStartVisualSort={(session) => setVisualSort(session)}
            onSortCompleted={() => {
              void fetchMeta();
              void fetchGallery();
            }}
          />
        ) : (
          <MediaGrid
            items={items}
            totalCount={isSearchActive ? items.length : totalItems || items.length}
            viewKey={`${JSON.stringify(nav)}-${isSearchActive}-${mediaType}-${sortBy}`}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onOpenLightbox={setLightboxItem}
            onToggleFavorite={handleToggleFavorite}
            isSearchActive={isSearchActive}
            isIndexing={Boolean(status?.indexingState.running || status?.scanProgress.scanning)}
            loading={loading || searching}
            onOpenConnectModal={() => setConnectOpen(true)}
          />
        )}
      </main>

      <FloatingDock
        activeNav={nav}
        onSelectNav={(section) => {
          setNav(section);
          if (isSearchActive && section.type !== 'sort-studio') {
            setIsSearchActive(false);
            setQuery('');
          }
        }}
        mediaType={mediaType}
        onMediaTypeChange={setMediaType}
        onOpenConnect={() => setConnectOpen(true)}
      />

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
        onConnected={(info) => {
          setNav({ type: 'all' });
          void fetchMeta();
          void fetchGallery();
          if (info?.autoOrganize) {
            setTimeout(() => {
              void launchVisualFolderOrganize(info.folderId, info.path, info.preset);
            }, 600);
          }
        }}
      />

      {visualSort && (
        <SortingTheater
          session={visualSort}
          realProgress={status?.sortProgress || null}
          onClose={() => {
            setVisualSort(null);
            void fetchMeta();
            void fetchGallery();
          }}
        />
      )}

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
