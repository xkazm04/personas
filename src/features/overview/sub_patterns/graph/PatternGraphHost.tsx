// Topic-graph host — Nexus won the /prototype rounds (hub-and-spoke reads
// best and scales to nested levels); the variant switcher and the losing
// skies are gone. Owns the camera, the drill-down focus (overview = crest +
// areas; click flies INTO the clicked node, Google-Maps style; breadcrumb /
// Esc / double-click fly home), the selection, and the project lens (adopted
// topics keep colour, everything else greys out).
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, X } from 'lucide-react';

import {
  deletePlaybook,
  listPatternEdges,
  listPlaybookPatterns,
  listPlaybooks,
  listPracticeContextRollup,
  setPlaybookStatus,
} from '@/api/devTools/workspaces';
import { useTranslation } from '@/i18n/useTranslation';
import type { PracticeContextRollup } from '@/lib/bindings/PracticeContextRollup';
import type { WorkspacePatternEdge } from '@/lib/bindings/WorkspacePatternEdge';
import type { WorkspacePlaybook } from '@/lib/bindings/WorkspacePlaybook';
import type { WorkspacePlaybookPattern } from '@/lib/bindings/WorkspacePlaybookPattern';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { areaTheme } from '../practiceAreaTheme';
import type { KnowledgeItemView } from '../libraryModel';
import {
  buildEdgeViews,
  buildFabricIndex,
  buildTopicGraph,
  foldTopicCoverage,
  topicCoverageKeys,
  type ClusterNode,
  type FabricMatch,
  type FacetNode,
} from './graphModel';
import { ClusterPatternsModal } from './ClusterPatternsModal';
import { CreatePlaybookModal } from './CreatePlaybookModal';
import { FabricSearch } from './FabricSearch';
import { PlaybooksPanel } from './PlaybooksPanel';
import { ZoomRail } from './GraphChrome';
import PatternGraphNexus, { computeNexusLayout, type FlyTarget } from './PatternGraphNexus';
import { useGraphCanvas } from './useGraphCanvas';

export default function PatternGraphHost({
  items,
  workspaceId,
  workspaceName,
  adoptions,
  selectedProjectId,
  projectCount,
  onOpenItem,
}: {
  items: readonly KnowledgeItemView[];
  workspaceId: string;
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
  const [focusCluster, setFocusCluster] = useState<string | null>(null);
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
      if (!adoptedPractices.has(item.id)) continue;
      // Both grains: the facet node greys/keeps colour on its own key, the
      // cluster keeps colour when ANY facet under it is applied.
      const keys = topicCoverageKeys(item.topic);
      if (!keys) continue;
      topics.add(keys.cluster);
      topics.add(keys.full);
    }
    return topics as ReadonlySet<string>;
  }, [selectedProjectId, adoptions, items]);

  // Context-grain adherence (docs/concepts/pattern-context-trace.md): one
  // rollup row per practice — adopted/violating/unverified over APPLICABLE
  // contexts. Where these rows exist they take over the rings from the
  // project-grain matrix below, because one `adopted` matrix cell rendering
  // as "the whole project follows this" is exactly the overstatement the
  // context grain corrects. P0 reality check: seeding is envelope-only, so
  // adherence reads LOW (mostly `unverified`) — that low number is the honest
  // baseline, not a bug.
  const [rollup, setRollup] = useState<PracticeContextRollup[] | null>(null);
  useEffect(() => {
    let live = true;
    listPracticeContextRollup(workspaceId, selectedProjectId)
      .then((rows) => { if (live) setRollup(rows); })
      // Missing rollup degrades to the matrix-grain rings; never interrupts.
      .catch((err) => {
        silentCatch('patterns:contextRollup')(err);
        if (live) setRollup(null);
      });
    return () => { live = false; };
  }, [workspaceId, selectedProjectId, items]);

  // Pattern connections (fabric S2). Missing command (pre-rebuild binary)
  // degrades to no links + no related rows — never interrupts.
  const [edges, setEdges] = useState<WorkspacePatternEdge[]>([]);
  useEffect(() => {
    let live = true;
    listPatternEdges(workspaceId)
      .then((rows) => { if (live) setEdges(rows); })
      .catch((err) => {
        silentCatch('patterns:edges')(err);
        if (live) setEdges([]);
      });
    return () => { live = false; };
  }, [workspaceId, items]);

  const edgeViews = useMemo(
    () => buildEdgeViews(edges.map((e) => ({ fromId: e.fromId, toId: e.toId, rel: e.rel, note: e.note })), items),
    [edges, items],
  );

  // Playbooks (fabric S3) + the cross-modal selection basket the curator UI
  // builds them from. Missing commands degrade to an empty rail.
  const [playbooks, setPlaybooks] = useState<WorkspacePlaybook[]>([]);
  const [playbookMembers, setPlaybookMembers] = useState<WorkspacePlaybookPattern[]>([]);
  const [playbooksGen, setPlaybooksGen] = useState(0);
  const [showPlaybooks, setShowPlaybooks] = useState(false);
  const [basket, setBasket] = useState<ReadonlyMap<string, KnowledgeItemView>>(new Map());
  const [creatingPlaybook, setCreatingPlaybook] = useState(false);
  useEffect(() => {
    let live = true;
    void playbooksGen;
    Promise.all([listPlaybooks(workspaceId), listPlaybookPatterns(workspaceId)])
      .then(([pbs, mems]) => {
        if (live) {
          setPlaybooks(pbs);
          setPlaybookMembers(mems);
        }
      })
      .catch((err) => {
        silentCatch('patterns:playbooks')(err);
        if (live) {
          setPlaybooks([]);
          setPlaybookMembers([]);
        }
      });
    return () => { live = false; };
  }, [workspaceId, playbooksGen]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const toggleBasket = (item: KnowledgeItemView) => {
    setBasket((cur) => {
      const next = new Map(cur);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  };

  const contextCoverage = useMemo(() => {
    if (!rollup || rollup.length === 0) return null;
    const byPractice = new Map(rollup.map((r) => [r.practiceId, r]));
    // Keyed at FULL topic depth (facet nodes carry their own ring); the fold
    // also credits each practice to its cluster and area, so a cluster ring is
    // the aggregate over its facets plus any items directly under it.
    const { topic, area } = foldTopicCoverage(items, (item) => {
      const r = byPractice.get(item.id);
      return r && r.applicable > 0 ? { num: r.adopted, den: r.applicable } : null;
    });
    return { topic, area, byPractice };
  }, [rollup, items]);

  // Fallback: resolved share of the pattern×project adoption matrix. A cell
  // counts as RESOLVED when it is `adopted` (accepted) or `na` (skipped as
  // inapplicable to that project's stack); everything else (proposed /
  // to_process / dispatched / diverged) is work still owed. The denominator is
  // practices × member projects (× 1 under a project lens), so pending
  // practices — which have no cells yet — honestly drag coverage down.
  const coverage = useMemo(() => {
    const resolvedByPractice = new Map<string, number>();
    for (const a of adoptions) {
      if (selectedProjectId && a.project_id !== selectedProjectId) continue;
      if (a.state !== 'adopted' && a.state !== 'na') continue;
      resolvedByPractice.set(a.practice_id, (resolvedByPractice.get(a.practice_id) ?? 0) + 1);
    }
    const denomPer = selectedProjectId ? 1 : projectCount;
    const { topic, area } =
      denomPer > 0
        ? foldTopicCoverage(items, (item) => ({
            num: Math.min(resolvedByPractice.get(item.id) ?? 0, denomPer),
            den: denomPer,
          }))
        : { topic: new Map<string, number>(), area: new Map<string, number>() };
    const perPattern = (item: KnowledgeItemView): number | null =>
      denomPer > 0 ? Math.min(resolvedByPractice.get(item.id) ?? 0, denomPer) / denomPer : null;
    return { topic, area, perPattern, enabled: denomPer > 0 };
  }, [adoptions, items, selectedProjectId, projectCount]);

  // Ring inputs: context-grain adherence wins per key; the matrix share is the
  // fallback for topics (and workspaces) with no context map behind them.
  const ringTopic = useMemo(() => {
    if (!contextCoverage && !coverage.enabled) return null;
    const merged = new Map(coverage.enabled ? coverage.topic : []);
    if (contextCoverage) for (const [k, v] of contextCoverage.topic) merged.set(k, v);
    return merged as ReadonlyMap<string, number>;
  }, [contextCoverage, coverage]);
  const ringArea = useMemo(() => {
    if (!contextCoverage && !coverage.enabled) return null;
    const merged = new Map(coverage.enabled ? coverage.area : []);
    if (contextCoverage) for (const [k, v] of contextCoverage.area) merged.set(k, v);
    return merged as ReadonlyMap<string, number>;
  }, [contextCoverage, coverage]);

  // Modal readout: context adherence with its verified fraction when the
  // rollup knows the practice; matrix share (no detail line) otherwise.
  const patternCoverage = (item: KnowledgeItemView): { pct: number; detail?: string } | null => {
    const r = contextCoverage?.byPractice.get(item.id);
    if (r && r.applicable > 0) {
      return {
        pct: r.adopted / r.applicable,
        detail: tx(w.graph_ctx_verified, {
          verified: r.adopted + r.violating,
          applicable: r.applicable,
        }),
      };
    }
    const pct = coverage.perPattern(item);
    return pct === null ? null : { pct };
  };

  const flyHome = () => {
    setFocusArea(null);
    setFocusCluster(null);
    setSelected(null);
    canvas.reset();
  };

  const focusOn = (area: string, target: FlyTarget) => {
    if (focusArea === area && !focusCluster) {
      flyHome();
      return;
    }
    setFocusArea(area);
    setFocusCluster(null);
    setSelected(null);
    canvas.flyTo(target.x, target.y, target.k);
  };

  // Second drill: a cluster with third-level topics unfolds its ring.
  const drillCluster = (node: ClusterNode, target: FlyTarget) => {
    if (focusCluster === node.topic) {
      // Toggle back out to the area level.
      setFocusCluster(null);
      canvas.flyTo(target.x, target.y, 1.5);
      return;
    }
    setFocusArea(node.area);
    setFocusCluster(node.topic);
    setSelected(null);
    canvas.flyTo(target.x, target.y, target.k);
  };

  // A third-level topic opens its pattern stack — same modal, facet-shaped
  // node (a FacetNode is a leaf ClusterNode with the facet as its label).
  const selectFacet = (f: FacetNode) => {
    setSelected({
      topic: f.topic,
      area: f.area,
      cluster: f.facet,
      count: f.count,
      pending: f.pending,
      adopted: f.items.filter((i) => i.status === 'adopted').length,
      items: f.items,
      facets: [],
    });
  };

  // Leaf click: the cluster is the tree's last level while patterns stay off
  // the canvas, so it opens the structured patterns modal directly (a camera
  // flight under a full modal would never be seen). Its area stays focused so
  // closing the modal leaves you inside the dimension you were exploring.
  const selectCluster = (node: ClusterNode) => {
    setSelected(node);
    setFocusArea(node.area);
  };

  // -- omnibox ---------------------------------------------------------------
  // Search navigates DIRECTLY: the click handlers above are toggles (clicking
  // the focused area flies home), which is right for the canvas and wrong for
  // a chosen search result — picking "ui" must always land on ui.
  const fabricIndex = useMemo(() => buildFabricIndex(graph), [graph]);
  const layout = useMemo(() => computeNexusLayout(graph), [graph]);

  const goArea = (area: string) => {
    setFocusArea(area);
    setFocusCluster(null);
    setSelected(null);
    const p = layout.areaPos.get(area);
    if (p) canvas.flyTo(p.x, p.y, 1.5);
  };

  const goCluster = (node: ClusterNode, drill: boolean) => {
    setFocusArea(node.area);
    setFocusCluster(drill ? node.topic : null);
    setSelected(null);
    const p = layout.clusterPos.get(node.topic);
    if (p) canvas.flyTo(p.x, p.y, drill ? 2.3 : 1.9);
  };

  const onSearchSelect = (m: FabricMatch) => {
    if (m.kind === 'area') {
      goArea(m.node.area);
      return;
    }
    if (m.kind === 'cluster') {
      // A cluster with facets drills open; a true leaf opens its stack.
      goCluster(m.cluster, m.cluster.facets.length > 0);
      if (m.cluster.facets.length === 0) selectCluster(m.cluster);
      return;
    }
    if (m.kind === 'facet') {
      goCluster(m.cluster, true);
      selectFacet(m.facet);
      return;
    }
    // A pattern opens the stack that actually contains it — its facet when it
    // has a third-level topic, its cluster otherwise.
    if (m.facet) {
      goCluster(m.cluster, true);
      selectFacet(m.facet);
    } else {
      goCluster(m.cluster, false);
      selectCluster(m.cluster);
    }
  };

  // Esc walks back out — selection first, then the focused dimension.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (focusCluster) setFocusCluster(null);
      else if (focusArea) flyHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focusCluster, focusArea]);

  const { width, height } = canvas.size;
  const { x, y, k } = canvas.camera;

  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
        <FabricSearch index={fabricIndex} onSelect={onSearchSelect} />
        <button
          type="button"
          onClick={() => setShowPlaybooks((v) => !v)}
          aria-pressed={showPlaybooks}
          className={`typo-label flex items-center gap-1.5 rounded-interactive border px-2.5 py-1 transition-colors ${
            showPlaybooks
              ? 'border-primary/25 bg-primary/10 text-foreground'
              : 'border-border/60 bg-secondary/50 text-foreground/70 hover:text-foreground'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" aria-hidden />
          {w.playbooks_title}
          <span className="tabular-nums text-foreground/55">{playbooks.length}</span>
          {basket.size > 0 && (
            <span className="tabular-nums rounded-pill bg-primary/15 text-primary px-1.5">
              +{basket.size}
            </span>
          )}
        </button>
        </div>
        <span className="typo-caption text-foreground/50 tabular-nums flex-shrink-0">
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
            ref={canvas.svgRef}
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
                topicCoverage={ringTopic}
                areaCoverage={ringArea}
                clusterLinks={edgeViews.clusterLinks}
                focusCluster={focusCluster}
                onHoverArea={setHoverArea}
                onFocusArea={focusOn}
                onFocusCluster={drillCluster}
                onSelectCluster={selectCluster}
                onSelectFacet={selectFacet}
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
            {focusCluster && (
              <>
                <ChevronRight className="w-3 h-3 text-foreground/40" aria-hidden />
                <button
                  type="button"
                  onClick={() => setFocusCluster(null)}
                  className={`typo-label px-1.5 py-0.5 rounded-interactive ${areaTheme(focusCluster).chip}`}
                >
                  {focusCluster.split('/')[1] ?? focusCluster}
                </button>
              </>
            )}
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

        {showPlaybooks && (
          <PlaybooksPanel
            playbooks={playbooks}
            members={playbookMembers}
            itemById={itemById}
            basketCount={basket.size}
            onCreateFromBasket={() => setCreatingPlaybook(true)}
            onSetStatus={(id, status) => {
              setPlaybookStatus(id, status)
                .then(() => setPlaybooksGen((g) => g + 1))
                .catch(toastCatch('workspaces:playbookStatus'));
            }}
            onDelete={(id) => {
              deletePlaybook(id)
                .then(() => setPlaybooksGen((g) => g + 1))
                .catch(toastCatch('workspaces:playbookDelete'));
            }}
            onOpenItem={onOpenItem}
            onClose={() => setShowPlaybooks(false)}
          />
        )}

        {selected && (
          <ClusterPatternsModal
            key={selected.topic}
            node={selected}
            patternCoverage={patternCoverage}
            relatedFor={(item) => edgeViews.byPractice.get(item.id) ?? []}
            basketIds={basket}
            onToggleBasket={toggleBasket}
            onOpenRelated={(otherId) => {
              const target = items.find((i) => i.id === otherId);
              if (target) onOpenItem?.(target);
            }}
            onOpenItem={onOpenItem}
            onClose={() => setSelected(null)}
          />
        )}

        {creatingPlaybook && (
          <CreatePlaybookModal
            workspaceId={workspaceId}
            basket={[...basket.values()]}
            onCreated={() => {
              setBasket(new Map());
              setPlaybooksGen((g) => g + 1);
            }}
            onClose={() => setCreatingPlaybook(false)}
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
