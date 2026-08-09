// Topic-graph host — owns the camera, the selection, and the PROTOTYPE-ONLY
// variant switcher (three directional skies; the switcher and the losers are
// deleted at consolidation per /prototype Phase 5). The variants are pure
// geometry: same props in, radically different sky out.
import { useMemo, useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import type { KnowledgeItemView } from '../libraryModel';
import { buildTopicGraph, type ClusterNode } from './graphModel';
import { ClusterCard, ZoomRail } from './GraphChrome';
import PatternGraphNexus from './PatternGraphNexus';
import PatternGraphNebula from './PatternGraphNebula';
import PatternGraphSectors from './PatternGraphSectors';
import { useGraphCanvas } from './useGraphCanvas';

type GraphVariant = 'nexus' | 'sectors' | 'nebula';

// Throwaway labels — prototype chrome, never ships.
const VARIANTS: { id: GraphVariant; label: string }[] = [
  { id: 'nexus', label: 'Nexus' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'nebula', label: 'Nebula' },
];

export default function PatternGraphHost({
  items,
  workspaceName,
  onOpenItem,
}: {
  items: readonly KnowledgeItemView[];
  workspaceName: string;
  onOpenItem?: (item: KnowledgeItemView) => void;
}) {
  const [variant, setVariant] = useState<GraphVariant>('nexus');
  const [hoverArea, setHoverArea] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClusterNode | null>(null);
  const canvas = useGraphCanvas({ initialK: 0.8 });

  const graph = useMemo(() => buildTopicGraph(items), [items]);

  const Variant =
    variant === 'nexus' ? PatternGraphNexus : variant === 'sectors' ? PatternGraphSectors : PatternGraphNebula;

  const { width, height } = canvas.size;
  const { x, y, k } = canvas.camera;

  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <SegmentedTabs<GraphVariant>
          tabs={VARIANTS.map((v) => ({ id: v.id, label: v.label }))}
          activeTab={variant}
          onTabChange={(v) => { setVariant(v); setSelected(null); canvas.reset(); }}
          ariaLabel="Graph variant (prototype)"
          fullWidth={false}
          size="sm"
        />
        <span className="typo-caption text-foreground/50 tabular-nums">
          {graph.total} practices · {graph.pending} pending
        </span>
      </div>

      <div
        ref={canvas.containerRef}
        className="relative flex-1 min-h-0 rounded-card border border-border/60 bg-secondary/20 overflow-hidden"
        style={{ cursor: canvas.isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            {...canvas.handlers}
            onClick={() => setSelected(null)}
            role="img"
            aria-label="Topic graph"
          >
            <g transform={`translate(${width / 2 + x},${height / 2 + y}) scale(${k})`}>
              <Variant
                graph={graph}
                k={k}
                workspaceName={workspaceName}
                hoverArea={hoverArea}
                selectedTopic={selected?.topic ?? null}
                onHoverArea={setHoverArea}
                onSelectCluster={(node) => setSelected((cur) => (cur?.topic === node.topic ? null : node))}
              />
            </g>
          </svg>
        )}

        <ZoomRail k={k} zoomBy={canvas.zoomBy} reset={canvas.reset} />

        {selected && (
          <ClusterCard node={selected} onOpenItem={onOpenItem} onClose={() => setSelected(null)} />
        )}

        {graph.total === 0 && (
          <div className="absolute inset-x-0 top-4 flex justify-center pointer-events-none">
            <span className="typo-caption text-foreground/50 bg-background/80 rounded-interactive px-2.5 py-1">
              No practices yet — areas light up as the library grows.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
