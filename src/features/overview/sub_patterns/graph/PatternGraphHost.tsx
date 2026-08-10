// Topic-graph host — Nexus won the /prototype rounds (hub-and-spoke reads
// best and scales to nested levels); the variant switcher and the losing
// skies are gone. Owns the camera, the drill-down focus (overview = crest +
// areas; click flies INTO the clicked node, Google-Maps style; breadcrumb /
// Esc / double-click fly home), the selection, and the project lens (adopted
// topics keep colour, everything else greys out).
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';
import { areaTheme } from '../practiceAreaTheme';
import type { KnowledgeItemView } from '../libraryModel';
import { buildTopicGraph, type ClusterNode } from './graphModel';
import { ClusterPatternsModal } from './ClusterPatternsModal';
import { ZoomRail } from './GraphChrome';
import PatternGraphNexus, { type FlyTarget } from './PatternGraphNexus';
import { useGraphCanvas } from './useGraphCanvas';

export default function PatternGraphHost({
  items,
  workspaceName,
  adoptions,
  selectedProjectId,
  projectCount,
  onOpenItem,
}: {
  items: readonly KnowledgeItemView[];
  workspaceName: string;
  adoptions: readonly WorkspacePracticeAdoption[];
  /** Project lens; `null` = whole workspace, rendered as-is. */
  selectedProjectId: string | null;
  /** Member-project count — the coverage denominator when no lens is set. */
  projectCount: number;
  onOpenItem?: (item: KnowledgeItemView) => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [hoverArea, setHoverArea] = useState<string | null>(null);
  const [focusArea, setFocusArea] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClusterNode | null>(null);
  const canvas = useGraphCanvas({ initialK: 0.8 });

  const graph = useMemo(() => buildTopicGraph(items), [items]);

  // Project lens: the set of topics with at least one practice ADOPTED (in
  // any capacity the matrix records as landed) by the selected project.
  const appliedTopics = useMemo(() => {
    if (!selectedProjectId) return null;
    const adoptedPractices = new Set(
      adoptions
        .filter((a) => a.project_id === selectedProjectId && a.state === 'adopted')
        .map((a) => a.practice_id),
    );
    const topics = new Set<string>();
    for (const item of items) {
      if (adoptedPractices.has(item.id)) {
        const [area = '', cluster = ''] = item.topic.split('/');
        if (area) topics.add(`${area}/${cluster || 'general'}`);
      }
    }
    return topics as ReadonlySet<string>;
  }, [selectedProjectId, adoptions, items]);

  // Completion traceability — the resolved share of the pattern×project
  // adoption matrix. A cell counts as RESOLVED when it is `adopted` (accepted)
  // or `na` (skipped as inapplicable to that project's stack); everything else
  // (proposed / to_process / dispatched / diverged) is work still owed. The
  // denominator is practices × member projects (× 1 under a project lens), so
  // pending practices — which have no cells yet — honestly drag coverage down.
  const coverage = useMemo(() => {
    const resolvedByPractice = new Map<string, number>();
    for (const a of adoptions) {
      if (selectedProjectId && a.project_id !== selectedProjectId) continue;
      if (a.state !== 'adopted' && a.state !== 'na') continue;
      resolvedByPractice.set(a.practice_id, (resolvedByPractice.get(a.practice_id) ?? 0) + 1);
    }
    const denomPer = selectedProjectId ? 1 : projectCount;
    const topic = new Map<string, number>();
    const area = new Map<string, number>();
    if (denomPer > 0) {
      const acc = new Map<string, { res: number; tot: number }>();
      const accArea = new Map<string, { res: number; tot: number }>();
      for (const item of items) {
        const [a = '', c = ''] = item.topic.split('/');
        if (!a) continue;
        const key = `${a}/${c || 'general'}`;
        const res = Math.min(resolvedByPractice.get(item.id) ?? 0, denomPer);
        const t0 = acc.get(key) ?? { res: 0, tot: 0 };
        t0.res += res;
        t0.tot += denomPer;
        acc.set(key, t0);
        const a0 = accArea.get(a) ?? { res: 0, tot: 0 };
        a0.res += res;
        a0.tot += denomPer;
        accArea.set(a, a0);
      }
      for (const [k, v] of acc) topic.set(k, v.tot > 0 ? v.res / v.tot : 0);
      for (const [k, v] of accArea) area.set(k, v.tot > 0 ? v.res / v.tot : 0);
    }
    const perPattern = (item: KnowledgeItemView): number | null =>
      denomPer > 0 ? Math.min(resolvedByPractice.get(item.id) ?? 0, denomPer) / denomPer : null;
    return { topic, area, perPattern, enabled: denomPer > 0 };
  }, [adoptions, items, selectedProjectId, projectCount]);

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

  // Leaf click: the cluster is the tree's last level while patterns stay off
  // the canvas, so it opens the structured patterns modal directly (a camera
  // flight under a full modal would never be seen). Its area stays focused so
  // closing the modal leaves you inside the dimension you were exploring.
  const selectCluster = (node: ClusterNode) => {
    setSelected(node);
    setFocusArea(node.area);
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

  const { width, height } = canvas.size;
  const { x, y, k } = canvas.camera;

  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      <div className="flex items-center justify-end gap-3 flex-shrink-0">
        <span className="typo-caption text-foreground/50 tabular-nums">
          {tx(w.graph_stats, { total: graph.total, pending: graph.pending })}
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
            aria-label={w.graph_aria}
          >
            <g transform={`translate(${width / 2 + x},${height / 2 + y}) scale(${k})`}>
              <PatternGraphNexus
                graph={graph}
                k={k}
                workspaceName={workspaceName}
                hoverArea={hoverArea}
                focusArea={focusArea}
                selectedTopic={selected?.topic ?? null}
                appliedTopics={appliedTopics}
                topicCoverage={coverage.enabled ? coverage.topic : null}
                areaCoverage={coverage.enabled ? coverage.area : null}
                onHoverArea={setHoverArea}
                onFocusArea={focusOn}
                onSelectCluster={selectCluster}
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
              aria-label={w.graph_back}
              className="ml-0.5 text-foreground/50 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <ZoomRail k={k} zoomBy={canvas.zoomBy} reset={flyHome} />

        {selected && (
          <ClusterPatternsModal
            node={selected}
            patternCoverage={coverage.perPattern}
            onOpenItem={onOpenItem}
            onClose={() => setSelected(null)}
          />
        )}

        {graph.total === 0 && (
          <div className="absolute inset-x-0 top-4 flex justify-center pointer-events-none">
            <span className="typo-caption text-foreground/50 bg-background/80 rounded-interactive px-2.5 py-1">
              {w.graph_empty}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
