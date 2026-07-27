import { useState, useMemo } from 'react';
import { CalendarDays, Image, Box, FolderOpen, FolderSearch, Search, SortAsc, SortDesc, AlertTriangle, RefreshCw } from 'lucide-react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useArtistAssets } from '../hooks/useArtistAssets';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { GalleryMode } from '../types';
import Gallery2D from './Gallery2D';
import Gallery3D from './Gallery3D';
import { groupAssetsByDay, type AssetGroupKey } from './groupByDay';
import { useTranslation } from '@/i18n/useTranslation';

export default function GalleryPage() {
  const { t } = useTranslation();
  const galleryMode = useSystemStore((s) => s.galleryMode);
  const setGalleryMode = useSystemStore((s) => s.setGalleryMode);
  const artistFolder = useSystemStore((s) => s.artistFolder);
  const { assets, loading, error, scanning, scanAndImport, deleteAsset, updateTags, renameAsset, loadAssets } = useArtistAssets();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [grouped, setGrouped] = useState(false);

  const filteredAssets = useMemo(() => {
    let list = assets.filter((a) => a.assetType === galleryMode);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.fileName.toLowerCase().includes(q) ||
          (a.tags ?? '').toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      const cmp = sortBy === 'name' ? a.fileName.localeCompare(b.fileName)
        : sortBy === 'date' ? a.createdAt.localeCompare(b.createdAt)
        : Number(a.fileSize) - Number(b.fileSize);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [assets, galleryMode, search, sortBy, sortDir]);

  const toggleSort = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));

  const groups = useMemo(
    () => (grouped ? groupAssetsByDay(filteredAssets) : null),
    [grouped, filteredAssets],
  );

  // ── Loading choreography (docs/design/overview-loading.md, tile-level) ──
  // Ghosts fill the tile grid ONLY while the region would otherwise be
  // empty during a fetch. Assets already on screen are never hidden by a
  // background reload (e.g. the error-state Retry button re-running
  // loadAssets()) — that's the same law GlobalExecutionList follows.
  const showGhost = loading && filteredAssets.length === 0;

  const groupLabel = (key: AssetGroupKey): string => {
    switch (key) {
      case 'group_today':
        return t.plugins.artist.group_today;
      case 'group_yesterday':
        return t.plugins.artist.group_yesterday;
      case 'group_this_week':
        return t.plugins.artist.group_this_week;
      case 'group_this_month':
        return t.plugins.artist.group_this_month;
      case 'group_older':
        return t.plugins.artist.group_older;
    }
  };

  const modes: { id: GalleryMode; label: string; icon: typeof Image }[] = [
    { id: '2d', label: t.plugins.artist.mode_2d, icon: Image },
    { id: '3d', label: t.plugins.artist.mode_3d, icon: Box },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap rounded-modal border border-primary/10 bg-card/70 px-3 py-2">
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-secondary/30 rounded-card border border-primary/10 p-0.5">
          {modes.map((m) => {
            const Icon = m.icon;
            const isActive = galleryMode === m.id;
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => setGalleryMode(m.id)}
                aria-pressed={isActive}
                title={m.label}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-card text-md transition-colors ${
                  isActive
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    : 'text-foreground hover:bg-secondary/40 border border-transparent'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="w-[17px] h-[17px] absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.plugins.artist.search}
            className="pl-8 pr-3 py-1.5 rounded-card bg-background/80 border border-primary/10 text-md text-foreground placeholder:text-foreground/40 focus-ring w-48"
          />
        </div>

        {/* Sort + group cluster */}
        <div className="flex items-center gap-0.5 bg-secondary/30 rounded-card border border-primary/10 p-0.5">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-2 py-1.5 rounded-card bg-transparent border border-transparent text-md text-foreground focus-ring"
          >
            <option value="date">{t.plugins.artist.sort_date}</option>
            <option value="name">{t.plugins.artist.sort_name}</option>
            <option value="size">{t.plugins.artist.sort_size}</option>
          </select>
          <button
            type="button"
            onClick={toggleSort}
            title={sortDir === 'asc' ? t.plugins.artist.sort_date : t.plugins.artist.sort_date}
            aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            className="w-9 h-9 flex items-center justify-center rounded-card border border-transparent text-foreground hover:bg-secondary/40 hover:text-foreground transition-colors"
          >
            {sortDir === 'asc' ? <SortAsc className="w-[18px] h-[18px]" /> : <SortDesc className="w-[18px] h-[18px]" />}
          </button>
          <button
            type="button"
            onClick={() => setGrouped((g) => !g)}
            aria-pressed={grouped}
            title={grouped ? t.plugins.artist.group_by_day_off : t.plugins.artist.group_by_day_on}
            className={`w-9 h-9 flex items-center justify-center rounded-card border transition-colors ${
              grouped
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                : 'text-foreground hover:bg-secondary/40 hover:text-foreground border-transparent'
            }`}
          >
            <CalendarDays className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Folder actions cluster */}
        <div className="flex items-center gap-0.5 bg-secondary/30 rounded-card border border-primary/10 p-0.5">
          <button
            type="button"
            onClick={() => artistFolder && openExternal(artistFolder).catch(silentCatch('Open artist folder'))}
            disabled={!artistFolder}
            title={t.plugins.artist.open_folder}
            aria-label={t.plugins.artist.open_folder}
            className="w-9 h-9 flex items-center justify-center rounded-card border border-transparent text-foreground hover:bg-secondary/40 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FolderOpen className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => artistFolder && scanAndImport(artistFolder)}
            disabled={scanning || !artistFolder}
            title={scanning ? t.plugins.artist.scanning : t.plugins.artist.scan_folder}
            aria-label={scanning ? t.plugins.artist.scanning : t.plugins.artist.scan_folder}
            className="w-9 h-9 flex items-center justify-center rounded-card border border-rose-500/25 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-rose-500/10"
          >
            <FolderSearch className={`w-[18px] h-[18px] ${scanning ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Folder info */}
      {artistFolder && (
        <p className="text-md text-foreground font-mono truncate">
          {t.plugins.artist.watching} {artistFolder}
        </p>
      )}

      {/* Gallery content */}
      {showGhost ? (
        /* Nothing to show yet + fetch in flight: ghost tiles in the real
           grid geometry, under the permanent toolbar above. Each ghost is
           invisible for its first ~120ms (animation-delay + fill-mode both)
           so a fast fetch skips them entirely; real tiles replace them the
           frame data arrives and ripple in via AnimatedList's own one-shot,
           key-guarded entrance (existing tiles never replay it). */
        <GalleryGhostGrid mode={galleryMode} />
      ) : error && filteredAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-red-500/5 border border-red-500/15 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
          <p className="typo-section-title">Could not load assets</p>
          <p className="typo-body text-foreground max-w-xs text-center">{error}</p>
          <button
            type="button"
            onClick={() => void loadAssets()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/5 border border-rose-500/10 flex items-center justify-center">
            {galleryMode === '2d' ? (
              <Image className="w-7 h-7 text-rose-400" />
            ) : (
              <Box className="w-7 h-7 text-rose-400" />
            )}
          </div>
          <p className="typo-section-title">
            {galleryMode === '2d' ? t.plugins.artist.no_images_yet : t.plugins.artist.no_models_yet}
          </p>
          <p className="typo-body text-foreground max-w-xs text-center">
            {galleryMode === '2d'
              ? t.plugins.artist.scan_import_images_hint
              : t.plugins.artist.scan_import_models_hint}
          </p>
        </div>
      ) : groups ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.labelKey} className="space-y-2">
              <header className="flex items-baseline gap-2 sticky top-0 z-10 bg-background/95 backdrop-blur py-1 -mx-2 px-2">
                <h3 className="typo-section-title">{groupLabel(group.labelKey)}</h3>
                <span className="text-md text-foreground tabular-nums">{group.assets.length}</span>
              </header>
              {galleryMode === '2d' ? (
                <Gallery2D
                  assets={group.assets}
                  onDelete={deleteAsset}
                  onUpdateTags={updateTags}
                  onRename={renameAsset}
                />
              ) : (
                <Gallery3D
                  assets={group.assets}
                  onDelete={deleteAsset}
                  onUpdateTags={updateTags}
                  onRename={renameAsset}
                />
              )}
            </section>
          ))}
        </div>
      ) : galleryMode === '2d' ? (
        <Gallery2D
          assets={filteredAssets}
          onDelete={deleteAsset}
          onUpdateTags={updateTags}
          onRename={renameAsset}
        />
      ) : (
        <Gallery3D
          assets={filteredAssets}
          onDelete={deleteAsset}
          onUpdateTags={updateTags}
          onRename={renameAsset}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryGhostGrid — calm ghost tiles for the ONLY moment the gallery has
// nothing to show (a fetch with a cold store / empty filter context). Mirrors
// AssetCard's geometry (aspect-square thumbnail + rounded-modal border + two
// label bars) inside the SAME grid template Gallery2D/Gallery3D render into,
// so the ghost→content swap moves nothing.
//
// Each tile enters via `animate-fade-in` (150ms, fill-mode: both) behind a
// staggered animation-delay starting at 120ms — `both` holds opacity 0 through
// the delay, so a fetch that resolves quickly never paints a single ghost.
// No `animate-pulse` — the entrance stagger is the only motion.
// ---------------------------------------------------------------------------

const GHOST_TILE_COUNT = 12;
const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghosts read as tiles, not a grid of clones. */
const GHOST_LABEL_WIDTHS = ['w-20', 'w-14', 'w-24', 'w-16'];

function GalleryGhostGrid({ mode }: { mode: GalleryMode }) {
  const gridCols =
    mode === '2d'
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';
  return (
    <div className={`grid ${gridCols} gap-3`} aria-hidden="true">
      {Array.from({ length: GHOST_TILE_COUNT }).map((_, i) => {
        const labelW = GHOST_LABEL_WIDTHS[i % GHOST_LABEL_WIDTHS.length];
        return (
          <div
            key={i}
            className="rounded-modal border border-primary/8 bg-card/40 overflow-hidden animate-fade-in"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          >
            <div className="aspect-square bg-primary/[0.06]" />
            <div className="px-3 py-2 space-y-1.5">
              <span className={`block h-3 ${labelW} max-w-full ${GHOST_BAR}`} />
              <span className="block h-2.5 w-12 rounded bg-primary/[0.06]" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
