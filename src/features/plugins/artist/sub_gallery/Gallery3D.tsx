import { useState } from 'react';
import { X, RotateCw, Grid3x3, Box } from 'lucide-react';
import type { ArtistAsset } from '@/api/artist';
import { useModelViewer } from '../hooks/useModelViewer';
import AssetCard from './AssetCard';

interface Gallery3DProps {
  assets: ArtistAsset[];
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string) => void;
}

export default function Gallery3D({ assets, onDelete, onUpdateTags }: Gallery3DProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const {
    wireframe, autoRotate, lightingPreset,
    toggleWireframe, toggleAutoRotate, setLightingPreset,
  } = useModelViewer();

  const selectedAsset = selectedIndex !== null ? assets[selectedIndex] : null;
  const isViewable = selectedAsset && ['glb', 'gltf'].includes(
    selectedAsset.fileName.split('.').pop()?.toLowerCase() ?? '',
  );

  return (
    <>
      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {assets.map((asset, i) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
            onClick={() => setSelectedIndex(i)}
          />
        ))}
      </div>

      {/* 3D Viewer Modal */}
      {selectedAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
          onClick={() => setSelectedIndex(null)}
        >
          <div
            className="relative w-[85vw] max-w-5xl h-[80vh] rounded-2xl border border-primary/10 bg-card overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-rose-400" />
                <span className="typo-heading text-foreground">{selectedAsset.fileName}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {selectedAsset.fileName.split('.').pop()?.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {/* Viewer controls */}
                <button
                  onClick={toggleAutoRotate}
                  className={`p-1.5 rounded-lg text-xs transition-colors ${
                    autoRotate ? 'bg-rose-500/15 text-rose-400' : 'text-muted-foreground hover:bg-secondary/40'
                  }`}
                  title="Auto-rotate"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={toggleWireframe}
                  className={`p-1.5 rounded-lg text-xs transition-colors ${
                    wireframe ? 'bg-rose-500/15 text-rose-400' : 'text-muted-foreground hover:bg-secondary/40'
                  }`}
                  title="Wireframe"
                >
                  <Grid3x3 className="w-3.5 h-3.5" />
                </button>
                <select
                  value={lightingPreset}
                  onChange={(e) => setLightingPreset(e.target.value as 'studio' | 'outdoor' | 'soft')}
                  className="px-2 py-1 rounded-lg bg-background/80 border border-primary/10 text-[11px] text-foreground"
                >
                  <option value="studio">Studio</option>
                  <option value="outdoor">Outdoor</option>
                  <option value="soft">Soft</option>
                </select>
                <button
                  onClick={() => setSelectedIndex(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary/40 ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Viewer area */}
            <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950">
              {isViewable ? (
                <ThreeViewer
                  filePath={selectedAsset.filePath}
                  wireframe={wireframe}
                  autoRotate={autoRotate}
                />
              ) : (
                <div className="text-center space-y-3">
                  <Box className="w-16 h-16 text-rose-400 mx-auto" />
                  <p className="typo-heading text-foreground">
                    Preview not available for .{selectedAsset.fileName.split('.').pop()} files
                  </p>
                  <p className="typo-body text-muted-foreground max-w-sm">
                    Only .glb and .gltf files can be previewed inline.
                    Export from Blender as glTF for best compatibility.
                  </p>
                </div>
              )}
            </div>

            {/* Footer metadata */}
            <div className="px-4 py-2 border-t border-primary/10 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>{formatFileSize(selectedAsset.fileSize)}</span>
              <span>{selectedAsset.createdAt}</span>
              {selectedAsset.tags && <span>Tags: {selectedAsset.tags}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Three.js Viewer placeholder — will use @react-three/fiber when installed
// ---------------------------------------------------------------------------

function ThreeViewer({
  filePath,
  wireframe,
  autoRotate,
}: {
  filePath: string;
  wireframe: boolean;
  autoRotate: boolean;
}) {
  // Three.js integration requires @react-three/fiber and @react-three/drei.
  // This placeholder renders a message until those deps are installed.
  return (
    <div className="text-center space-y-4 p-8">
      <div className="w-24 h-24 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/15 flex items-center justify-center">
        <Box className="w-12 h-12 text-rose-400" />
      </div>
      <div className="space-y-2">
        <p className="typo-heading text-foreground">3D Viewer</p>
        <p className="typo-body text-muted-foreground max-w-md">
          Install <code className="text-[11px] bg-secondary/40 px-1.5 py-0.5 rounded">@react-three/fiber</code> and{' '}
          <code className="text-[11px] bg-secondary/40 px-1.5 py-0.5 rounded">@react-three/drei</code> to
          enable interactive 3D previews with orbit controls.
        </p>
        <p className="text-[11px] text-muted-foreground font-mono break-all mt-2">
          {filePath}
        </p>
        <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-muted-foreground">
          {wireframe && <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">Wireframe</span>}
          {autoRotate && <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">Auto-rotate</span>}
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
