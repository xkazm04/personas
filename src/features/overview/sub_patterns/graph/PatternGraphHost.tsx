// Topic-graph host — owns the camera, the DRILL-DOWN focus (Google-Maps /
// Mastermind-canvas navigation: overview = crest + areas; click a keystone to
// fly into that dimension; breadcrumb / Esc / double-click flies home), the
// selection, and the PROTOTYPE-ONLY variant switcher (two finalists; Nebula
// was descoped in round 2). Variants are pure geometry: same props in,
// different sky out — including where the camera should land per area.
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { areaTheme } from '../practiceAreaTheme';
import type { KnowledgeItemView } from '../libraryModel';
import { buildTopicGraph, type ClusterNode } from './graphModel';
import { ClusterCard, ZoomRail } from './GraphChrome';
import PatternGraphNexus, { type FlyTarget } from './PatternGraphNexus';
import PatternGraphSectors from './PatternGraphSectors';
import { useGraphCanvas } from './useGraphCanvas';

type GraphVariant = 'nexus' | 'sectors';

// Throwaway labels — prototype chrome, never ships.
const VARIANTS: { id: GraphVariant; label: string }[] = [
  { id: 'nexus', label: 'Nexus' },
  { id: 'sectors', label: 'Sectors' },
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
  const [focusArea, setFocusArea] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClusterNode | null>(null);
  const canvas = useGraphCanvas({ initialK: 0.8 });

  const graph = useMemo(() => buildTopicGraph(items), [items]);

  const flyHome = () => {
    setFocusArea(null);
    setSelected(null);
    canvas.reset();
  };

  const focusOn = (area: string, target: FlyTarget) => {
    if (focusArea === area) {
      flyHome();
      return;
    }
    setFocusArea(area);
    setSelected(null);
    canvas.flyTo(target.x, target.y, target.k);
  };

  // Esc walks back out — selection first, then the focused dimension.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (focusArea) flyHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focusArea]);

  const Variant = variant === 'nexus' ? PatternGraphNexus : PatternGraphSectors;
  const { width, height } = canvas.size;
  const { x, y, k } = canvas.camera;

  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <SegmentedTabs<GraphVariant>
          tabs={VARIANTS.map((v) => ({ id: v.id, label: v.label }))}
          activeTab={variant}
          onTabChange={(v) => {
            setVariant(v);
            setFocusArea(null);
            setSelected(null);
            canvas.reset();
          }}
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
            onDoubleClick={flyHome}
            role="img"
            aria-label="Topic graph"
          >
            <g transform={`translate(${width / 2 + x},${height / 2 + y}) scale(${k})`}>
              <Variant
                graph={graph}
                k={k}
                workspaceName={workspaceName}
                hoverArea={hoverArea}
                focusArea={focusArea}
                selectedTopic={selected?.topic ?? null}
                onHoverArea={setHoverArea}
                onFocusArea={focusOn}
                onSelectCluster={(node) => setSelected((cur) => (cur?.topic === node.topic ? null : node))}
              />
            </g>
          </svg>
        )}

        {/* Breadcrumb — the way back out of a dimension. */}
        {focusArea && (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-interactive border border-border/70 bg-background/90 backdrop-blur-sm px-2 py-1 shadow-elevation-1 animate-fade-in">
            <button
              type="button"
              onClick={flyHome}
              className="typo-label text-foreground/70 hover:text-foreground transition-colors"
            >
              {workspaceName}
            </button>
            <ChevronRight className="w-3 h-3 text-foreground/40" aria-hidden />
            <span className={`typo-label px-1.5 py-0.5 rounded-interactive ${areaTheme(focusArea).chip}`}>
              {focusArea}
            </span>
            <button
              type="button"
              onClick={flyHome}
              aria-label="Back to overview"
              className="ml-0.5 text-foreground/50 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <ZoomRail k={k} zoomBy={canvas.zoomBy} reset={flyHome} />

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
