import { useState, useMemo } from 'react';
import { Image, Box, FolderSearch, Search, SortAsc, SortDesc } from 'lucide-react';
import { useArtistAssets } from '../hooks/useArtistAssets';
import { useSystemStore } from '@/stores/systemStore';
import type { GalleryMode } from '../types';
import Gallery2D from './Gallery2D';
import Gallery3D from './Gallery3D';

export default function GalleryPage() {
  const galleryMode = useSystemStore((s) => s.galleryMode);
  const setGalleryMode = useSystemStore((s) => s.setGalleryMode);
  const artistFolder = useSystemStore((s) => s.artistFolder);
  const { assets, loading, scanning, scanAndImport, deleteAsset, updateTags } = useArtistAssets();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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
      let cmp = 0;
      if (sortBy === 'name') cmp = a.fileName.localeCompare(b.fileName);
      else if (sortBy === 'date') cmp = a.createdAt.localeCompare(b.createdAt);
      else cmp = a.fileSize - b.fileSize;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [assets, galleryMode, search, sortBy, sortDir]);

  const toggleSort = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));

  const modes: { id: GalleryMode; label: string; icon: typeof Image }[] = [
    { id: '2d', label: '2D Images', icon: Image },
    { id: '3d', label: '3D Models', icon: Box },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Mode toggle */}
        {modes.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => setGalleryMode(m.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                galleryMode === m.id
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : 'text-muted-foreground hover:bg-secondary/40 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 pr-3 py-1.5 rounded-lg bg-background/80 border border-primary/10 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/30 w-48"
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="px-2 py-1.5 rounded-lg bg-background/80 border border-primary/10 text-xs text-foreground"
        >
          <option value="date">Date</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
        <button onClick={toggleSort} className="p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground">
          {sortDir === 'asc' ? <SortAsc className="w-3.5 h-3.5" /> : <SortDesc className="w-3.5 h-3.5" />}
        </button>

        {/* Scan button */}
        <button
          onClick={() => artistFolder && scanAndImport(artistFolder)}
          disabled={scanning || !artistFolder}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-40"
        >
          <FolderSearch className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan Folder'}
        </button>
      </div>

      {/* Folder info */}
      {artistFolder && (
        <p className="text-[11px] text-muted-foreground font-mono truncate">
          Watching: {artistFolder}
        </p>
      )}

      {/* Gallery content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground typo-body">
          Loading assets...
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
          <p className="typo-heading text-foreground">No {galleryMode === '2d' ? 'images' : 'models'} yet</p>
          <p className="typo-body text-muted-foreground max-w-xs text-center">
            Click "Scan Folder" to import {galleryMode === '2d' ? 'images' : '3D models'} from your Artist folder,
            or create them using the Blender Studio tab.
          </p>
        </div>
      ) : galleryMode === '2d' ? (
        <Gallery2D assets={filteredAssets} onDelete={deleteAsset} onUpdateTags={updateTags} />
      ) : (
        <Gallery3D assets={filteredAssets} onDelete={deleteAsset} onUpdateTags={updateTags} />
      )}
    </div>
  );
}
