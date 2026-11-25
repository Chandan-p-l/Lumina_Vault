import {
  Calendar,
  CopyCheck,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Heart,
  Images,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { FolderItem, NavSection, VaultStatus } from '../types';

interface SidebarProps {
  active: NavSection;
  onSelect: (section: NavSection) => void;
  folders: FolderItem[];
  status: VaultStatus | null;
  onOpenConnectModal: () => void;
  onOpenSettings: () => void;
  onRescanFolder: (id: number) => void;
  onRemoveFolder: (id: number) => void;
  onToggleAutoOrganize: (folder: FolderItem) => void;
  onOrganizeFolderNow: (id: number) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function Sidebar({
  active,
  onSelect,
  folders,
  status,
  onOpenConnectModal,
  onOpenSettings,
  onRescanFolder,
  onRemoveFolder,
  onToggleAutoOrganize,
  onOrganizeFolderNow,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const counts = status?.counts;
  const yearsMap = new Map<number, { total: number; months: Array<{ month: number; count: number }> }>();
  for (const row of status?.timeline || []) {
    const entry = yearsMap.get(row.year) || { total: 0, months: [] };
    entry.total += row.count;
    entry.months.push({ month: row.month, count: row.count });
    yearsMap.set(row.year, entry);
  }
  const years = Array.from(yearsMap.entries()).sort((a, b) => b[0] - a[0]);

  const navBtn = (isActive: boolean) =>
    `w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all ${
      isActive
        ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30 shadow-sm'
        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-transparent'
    }`;

  const content = (
    <div className="flex flex-col h-full bg-zinc-950/95 border-r border-zinc-800/80 w-72 select-none">
      {/* Brand Header */}
      <div className="px-4 py-4 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-base text-zinc-100 leading-tight">
              Lumina Vault
            </h1>
            <p className="text-[11px] text-zinc-400">Gemini AI Media Organizer</p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          title="Settings & Gemini API"
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Connect Folder CTA */}
      <div className="p-3">
        <button
          onClick={() => {
            onOpenConnectModal();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-violet-600/20 transition-all cursor-pointer"
        >
          <FolderPlus className="w-4 h-4" />
          Connect Any Folder
        </button>
      </div>

      {/* Scrollable Navigation */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
        {/* Library Section */}
        <div className="space-y-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
            Library
          </p>
          <button
            onClick={() => {
              onSelect({ type: 'all' });
              onCloseMobile();
            }}
            className={navBtn(active.type === 'all')}
          >
            <span className="flex items-center gap-2.5">
              <Images className="w-4 h-4" />
              All Photos & Videos
            </span>
            <span className="text-xs text-zinc-500">{counts?.total ?? 0}</span>
          </button>

          <button
            onClick={() => {
              onSelect({ type: 'favorites' });
              onCloseMobile();
            }}
            className={navBtn(active.type === 'favorites')}
          >
            <span className="flex items-center gap-2.5">
              <Heart className="w-4 h-4" />
              Favorites
            </span>
            <span className="text-xs text-zinc-500">{counts?.favorites ?? 0}</span>
          </button>

          <button
            onClick={() => {
              onSelect({ type: 'duplicates' });
              onCloseMobile();
            }}
            className={navBtn(active.type === 'duplicates')}
          >
            <span className="flex items-center gap-2.5">
              <CopyCheck className="w-4 h-4" />
              Duplicates
            </span>
            {(counts?.duplicateGroups ?? 0) > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300">
                {counts?.duplicateGroups}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              onSelect({ type: 'sort-studio' });
              onCloseMobile();
            }}
            className={navBtn(active.type === 'sort-studio')}
          >
            <span className="flex items-center gap-2.5">
              <FolderTree className="w-4 h-4 text-emerald-400" />
              Sort & Organize Studio
            </span>
          </button>
        </div>

        {/* Connected Folders */}
        <div className="space-y-1">
          <div className="px-3 flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Connected Folders ({folders.length})
            </p>
          </div>
          {folders.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 italic">
              No folders connected yet.
            </p>
          ) : (
            folders.map((folder) => {
              const isActive = active.type === 'folder' && active.folderId === folder.id;
              return (
                <div
                  key={folder.id}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all ${
                    isActive
                      ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-transparent'
                  }`}
                >
                  <button
                    onClick={() => {
                      onSelect({ type: 'folder', folderId: folder.id, name: folder.name });
                      onCloseMobile();
                    }}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                    title={folder.path}
                  >
                    <FolderOpen className="w-4 h-4 shrink-0 text-amber-400/80" />
                    <span className="truncate">{folder.name}</span>
                    {folder.auto_organize === 1 && (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-semibold uppercase tracking-wider shrink-0">
                        Auto
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-0.5 ml-1.5 shrink-0">
                    <span className="text-xs text-zinc-500 group-hover:hidden">
                      {folder.item_count ?? 0}
                    </span>
                    <button
                      onClick={() => onToggleAutoOrganize(folder)}
                      title={
                        folder.auto_organize === 1
                          ? 'Disable Auto-Organize & Move'
                          : 'Enable Auto-Organize & Move'
                      }
                      className={`hidden group-hover:flex p-1 rounded hover:bg-zinc-700 ${
                        folder.auto_organize === 1
                          ? 'text-emerald-400'
                          : 'text-zinc-400 hover:text-zinc-100'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onOrganizeFolderNow(folder.id)}
                      title="Organize & move into separate Photos/Videos folders now"
                      className="hidden group-hover:flex p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-emerald-300"
                    >
                      <FolderTree className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRescanFolder(folder.id)}
                      title="Rescan folder"
                      className="hidden group-hover:flex p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRemoveFolder(folder.id)}
                      title="Disconnect folder"
                      className="hidden group-hover:flex p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* AI Smart Categories */}
        {(status?.categories?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              AI Smart Categories
            </p>
            {status!.categories.map((cat) => {
              const isActive = active.type === 'category' && active.category === cat.category;
              return (
                <button
                  key={cat.category}
                  onClick={() => {
                    onSelect({ type: 'category', category: cat.category });
                    onCloseMobile();
                  }}
                  className={navBtn(isActive)}
                >
                  <span className="truncate flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400/80 shrink-0" />
                    <span className="truncate">{cat.category}</span>
                  </span>
                  <span className="text-xs text-zinc-500 ml-2">{cat.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Timeline */}
        {years.length > 0 && (
          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Timeline
            </p>
            {years.map(([year, info]) => {
              const isYearActive =
                active.type === 'timeline' && active.year === year && !active.month;
              return (
                <div key={year} className="space-y-0.5">
                  <button
                    onClick={() => {
                      onSelect({ type: 'timeline', year });
                      onCloseMobile();
                    }}
                    className={navBtn(isYearActive)}
                  >
                    <span className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                      {year}
                    </span>
                    <span className="text-xs text-zinc-500">{info.total}</span>
                  </button>
                  <div className="pl-7 flex flex-wrap gap-1 py-0.5">
                    {info.months.map((m) => {
                      const isMonthActive =
                        active.type === 'timeline' &&
                        active.year === year &&
                        active.month === m.month;
                      return (
                        <button
                          key={m.month}
                          onClick={() => {
                            onSelect({ type: 'timeline', year, month: m.month });
                            onCloseMobile();
                          }}
                          className={`px-2 py-0.5 rounded-md text-[11px] transition-colors cursor-pointer ${
                            isMonthActive
                              ? 'bg-violet-500/25 text-violet-200 border border-violet-500/40'
                              : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                          }`}
                        >
                          {MONTH_SHORT[m.month - 1]} ({m.count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer AI Status */}
      <div className="p-3 border-t border-zinc-800/80 bg-zinc-900/40 text-xs text-zinc-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              status?.hasApiKey ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span>
            AI Indexed: {counts?.indexed ?? 0}/{counts?.total ?? 0}
          </span>
        </div>
        <button
          onClick={onOpenSettings}
          className="text-violet-400 hover:text-violet-300 font-medium cursor-pointer"
        >
          API Key
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-full shrink-0">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
