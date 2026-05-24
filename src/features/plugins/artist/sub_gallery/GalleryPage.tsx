import { useState, useMemo } from 'react';
import { CalendarDays, Image, Box, FolderOpen, FolderSearch, Search, SortAsc, SortDesc } from 'lucide-react';
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
  const { assets, loading, scanning, scanAndImport, deleteAsset, updateTags, renameAsset } = useArtistAssets();

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
            className="pl-8 pr-3 py-1.5 rounded-card bg-background/80 border border-primary/10 text-md text-foreground placeholder:text-foreground focus:outline-none focus:border-rose-500/30 w-48"
          />
        </div>

        {/* Sort + group cluster */}
        <div className="flex items-center gap-0.5 bg-secondary/30 rounded-card border border-primary/10 p-0.5">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-2 py-1.5 rounded-card bg-transparent border border-transparent text-md text-foreground focus:outline-none focus:border-primary/20"
          >
            <option value="date">{t.plugins.artist.sort_date}</option>
            <option value="name">{t.plugins.artist.sort_name}</option>
            <option value="size">{t.plugins.artist.sort_size}</option>
          </select>
          <button
            onClick={toggleSort}
            title={sortDir === 'asc' ? t.plugins.artist.sort_date : t.plugins.artist.sort_date}
            aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            className="w-9 h-9 flex items-center justify-center rounded-card border border-transparent text-foreground hover:bg-secondary/40 hover:text-foreground transition-colors"
          >
            {sortDir === 'asc' ? <SortAsc className="w-[18px] h-[18px]" /> : <SortDesc className="w-[18px] h-[18px]" />}
          </button>
          <button
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
            onClick={() => artistFolder && openExternal(artistFolder).catch(silentCatch('Open artist folder'))}
            disabled={!artistFolder}
            title={t.plugins.artist.open_folder}
            aria-label={t.plugins.artist.open_folder}
            className="w-9 h-9 flex items-center justify-center rounded-card border border-transparent text-foreground hover:bg-secondary/40 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FolderOpen className="w-[18px] h-[18px]" />
          </button>
          <button
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
      {loading ? (
        <div className="flex items-center justify-center py-16 text-foreground typo-body">
          {t.plugins.artist.loading_assets}
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
