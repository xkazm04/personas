// Hierarchy graph host — the camera + focus state machine over HierarchyNexus
// (overview → category focused → subject focused → technique modal). Same
// interaction grammar as the old Nexus host: click flies INTO the clicked
// node, Esc walks back out one level, breadcrumb / double-click / ZoomRail
// reset fly home, free wheel-zoom crosses the same reveal thresholds. The
// toolbar carries the project source picker (shared persisted key with the
// Subjects lane), the search omnibox, and the Laws lens in the slot the old
// ProjectFilter occupied.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Scale, Search, X } from 'lucide-react';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

import { ZoomRail } from '../../graph/GraphChrome';
import { useGraphCanvas } from '../../graph/useGraphCanvas';
import { CorpusWarningsBadge } from '../CorpusWarningsBadge';
import { DocViewer } from '../DocViewer';
import {
  buildHierarchyIndex,
  resolveDocLink,
  searchHierarchy,
  type HierarchyMatch,
} from '../hierarchyModel';
import { initialHierarchyProjectId, persistHierarchyProjectId } from '../projectSource';
import { useHierarchyGraph } from '../useHierarchyGraph';
import { categoryGraphTheme } from './categoryTheme';
import HierarchyNexus, { type FlyTarget, type LawLensSets } from './HierarchyNexus';
import {
  buildHierarchyRenderModel,
  computeHierarchyLayout,
  techniqueKey,
  UNASSIGNED_RING,
  type SubjectNode,
  type TechniqueEntry,
} from './hierarchyGraphModel';
import { TechniqueModal } from './TechniqueModal';

/** The one place a law CHIP (id-only, no href) resolves to a path. */
const LAWS_FILE = 'docs/concepts/paths/_laws.md';

/** Search kind extended with category (categories live outside the shared
 *  index — there are 8 of them, matched by title/id locally). */
type OmniboxMatch =
  | { kind: 'category'; key: string; label: string; ring: string }
  | HierarchyMatch;

const EMPTY_SET: ReadonlySet<string> = new Set();

/** The four-status ring legend chip row (host chrome, not sky geometry). */
function StatusLegend() {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const stroke = 'var(--foreground)';
  const items: { key: string; label: string; sample: ReactNode }[] = [
    {
      key: 'draft',
      label: p.status_draft,
      sample: <circle cx={8} cy={8} r={5.5} fill="none" stroke={stroke} strokeOpacity={0.65} strokeWidth={1.25} strokeDasharray="3 2.5" />,
    },
    {
      key: 'forged',
      label: p.status_forged,
      sample: <circle cx={8} cy={8} r={5.5} fill="none" stroke={stroke} strokeWidth={1.5} />,
    },
    {
      key: 'reconciled',
      label: p.status_reconciled,
      sample: (
        <>
          <circle cx={8} cy={8} r={4.5} fill="none" stroke={stroke} strokeWidth={1.25} />
          <circle cx={8} cy={8} r={7} fill="none" stroke={stroke} strokeWidth={0.9} strokeOpacity={0.8} />
        </>
      ),
    },
    {
      key: 'transplant-tested',
      label: p.status_transplant_tested,
      sample: <circle cx={8} cy={8} r={5.5} fill={stroke} fillOpacity={0.55} stroke={stroke} strokeWidth={1.75} />,
    },
  ];
  return (
    <div
      className="absolute left-3 bottom-3 z-10 flex items-center gap-3 rounded-interactive border border-border/60 bg-background/85 backdrop-blur-sm px-2.5 py-1.5"
      role="img"
      aria-label={p.legend_aria}
    >
      {items.map((item) => (
        <span key={item.key} className="flex items-center gap-1.5">
          <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
            {item.sample}
          </svg>
          {/* muted-ok: legend micro-label, structural chrome */}
          <span className="typo-caption text-foreground/60 whitespace-nowrap">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

export default function HierarchyGraphHost({
  onOpenInSubjects,
}: {
  /** Lift into PatternsPanel: switch to the Subjects lane focused on this
   *  subject (and optionally one of its techniques). */
  onOpenInSubjects: (subjectSlug: string, techniqueSlug?: string) => void;
}) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const addToast = useToastStore((s) => s.addToast);
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  const projectIds = useMemo(() => projects.map((pr) => pr.id), [projects]);
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialHierarchyProjectId(projectIds),
  );
  useEffect(() => {
    if (projectId === null || !projectIds.includes(projectId)) {
      setProjectId(initialHierarchyProjectId(projectIds));
    }
  }, [projectIds, projectId]);
  const pickProject = useCallback((id: string) => {
    setProjectId(id);
    persistHierarchyProjectId(id);
  }, []);
  const projectName = useMemo(
    () => projects.find((pr) => pr.id === projectId)?.name ?? '',
    [projects, projectId],
  );

  const { graph, loading, error, refetch } = useHierarchyGraph(projectId);
  const model = useMemo(() => (graph ? buildHierarchyRenderModel(graph) : null), [graph]);
  const layout = useMemo(() => (model ? computeHierarchyLayout(model) : null), [model]);
  const index = useMemo(() => (graph ? buildHierarchyIndex(graph) : []), [graph]);

  // -- focus state machine ---------------------------------------------------
  const canvas = useGraphCanvas({ initialK: 0.8 });
  const [hoverRing, setHoverRing] = useState<string | null>(null);
  const [focusRing, setFocusRing] = useState<string | null>(null);
  const [focusSubject, setFocusSubject] = useState<string | null>(null);
  const [highlightTechnique, setHighlightTechnique] = useState<string | null>(null);
  const [techniqueModal, setTechniqueModal] = useState<{
    node: SubjectNode;
    entry: TechniqueEntry;
  } | null>(null);
  const [docViewer, setDocViewer] = useState<{ file: string; anchor: string | null } | null>(null);

  // A project switch invalidates every slug the focus state holds.
  useEffect(() => {
    setFocusRing(null);
    setFocusSubject(null);
    setHighlightTechnique(null);
    setTechniqueModal(null);
  }, [projectId]);

  const flyHome = useCallback(() => {
    setFocusRing(null);
    setFocusSubject(null);
    setHighlightTechnique(null);
    canvas.reset();
  }, [canvas]);

  const focusRingOn = (ring: string, target: FlyTarget) => {
    if (focusRing === ring && !focusSubject) {
      flyHome();
      return;
    }
    setFocusRing(ring);
    setFocusSubject(null);
    setHighlightTechnique(null);
    canvas.flyTo(target.x, target.y, target.k);
  };

  const focusSubjectOn = (node: SubjectNode, target: FlyTarget) => {
    if (focusSubject === node.subject.slug) {
      // Toggle back out to the category level.
      setFocusSubject(null);
      setHighlightTechnique(null);
      const kp = layout?.keystonePos.get(node.ring);
      if (kp) canvas.flyTo(kp.x, kp.y, 1.5);
      return;
    }
    setFocusRing(node.ring);
    setFocusSubject(node.subject.slug);
    setHighlightTechnique(null);
    canvas.flyTo(target.x, target.y, target.k);
  };

  // -- omnibox ---------------------------------------------------------------
  // Search navigates DIRECTLY: the canvas click handlers are toggles, which is
  // right for the canvas and wrong for a chosen search result.
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(searchRef, searchOpen, () => setSearchOpen(false));

  const nodeBySlug = useMemo(() => {
    const map = new Map<string, SubjectNode>();
    if (model) for (const ring of model.rings) for (const node of ring.subjects) map.set(node.subject.slug, node);
    return map;
  }, [model]);

  const matches = useMemo<OmniboxMatch[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !model) return [];
    const categories: OmniboxMatch[] = model.rings
      .filter((r) => r.id !== null && (r.title.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)))
      .map((r) => ({ kind: 'category' as const, key: `c:${r.key}`, label: r.title, ring: r.key }));
    return [...categories, ...searchHierarchy(index, query, 12)];
  }, [model, index, query]);

  const goSubject = useCallback(
    (slug: string, k = 2.3) => {
      const node = nodeBySlug.get(slug);
      const pos = layout?.subjectPos.get(slug);
      if (!node || !pos) return null;
      setFocusRing(node.ring);
      setFocusSubject(slug);
      canvas.flyTo(pos.x, pos.y, k);
      return node;
    },
    [nodeBySlug, layout, canvas],
  );

  const onSearchSelect = (m: OmniboxMatch) => {
    setSearchOpen(false);
    setQuery('');
    setHighlightTechnique(null);
    if (m.kind === 'category') {
      const kp = layout?.keystonePos.get(m.ring);
      setFocusRing(m.ring);
      setFocusSubject(null);
      if (kp) canvas.flyTo(kp.x, kp.y, 1.5);
      return;
    }
    if (m.kind === 'subject') {
      goSubject(m.subject);
      return;
    }
    if (m.kind === 'technique') {
      // Focus the OWNER subject and pulse the technique node.
      const node = goSubject(m.subject);
      if (node) setHighlightTechnique(`${m.subject}/${m.technique}`);
      return;
    }
    // Application → open its technique's modal (fall back to subject focus
    // when the technique row cannot be resolved).
    const node = goSubject(m.subject);
    if (!node || !graph) return;
    const app = graph.subjects
      .find((s) => s.slug === m.subject)
      ?.applications.find((a) => a.file === m.file);
    const entry = app
      ? node.techniques.find((e) => e.tech.slug === app.technique && e.tech.subject === m.subject)
      : undefined;
    if (entry) setTechniqueModal({ node, entry });
  };

  // -- Laws lens ---------------------------------------------------------------
  const [lawId, setLawId] = useState<string | null>(null);
  const [lawsOpen, setLawsOpen] = useState(false);
  const lawsRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(lawsRef, lawsOpen, () => setLawsOpen(false));
  useEffect(() => setLawId(null), [projectId]);

  const lawLens = useMemo<LawLensSets | null>(() => {
    if (!lawId || !model) return null;
    return {
      subjects: model.laws.subjectsByLaw.get(lawId) ?? EMPTY_SET,
      techniques: model.laws.techniquesByLaw.get(lawId) ?? EMPTY_SET,
    };
  }, [lawId, model]);

  // -- link interception (technique modal bodies) ------------------------------
  const handleLinkHref = useCallback(
    (currentFile: string, href: string): boolean => {
      if (!graph) return true;
      const target = resolveDocLink(currentFile, href, graph);
      if (!target) {
        addToast(p.link_not_in_hierarchy, 'warning');
        return true;
      }
      switch (target.kind) {
        case 'subject':
          setTechniqueModal(null);
          goSubject(target.subject);
          break;
        case 'technique': {
          const node = goSubject(target.subject);
          const entry = node?.techniques.find(
            (e) => e.tech.slug === target.technique && e.tech.subject === target.subject,
          );
          setTechniqueModal(node && entry ? { node, entry } : null);
          break;
        }
        case 'application':
          setDocViewer({ file: target.file, anchor: null });
          break;
        case 'law':
          setDocViewer({ file: target.file, anchor: target.law });
          break;
        case 'doc':
          setDocViewer({ file: target.file, anchor: target.anchor });
          break;
      }
      return true;
    },
    [graph, addToast, p.link_not_in_hierarchy, goSubject],
  );

  // Esc walks back out one level. Open overlays own their own Esc (BaseModal),
  // so the walk only runs when the sky itself has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (techniqueModal || docViewer || lawsOpen || searchOpen) return;
      if (focusSubject) {
        setFocusSubject(null);
        setHighlightTechnique(null);
        const node = nodeBySlug.get(focusSubject);
        const kp = node ? layout?.keystonePos.get(node.ring) : null;
        if (kp) canvas.flyTo(kp.x, kp.y, 1.5);
      } else if (focusRing) {
        flyHome();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [techniqueModal, docViewer, lawsOpen, searchOpen, focusSubject, focusRing, nodeBySlug, layout, canvas, flyHome]);

  const projectOptions = useMemo(
    () => projects.map((pr) => ({ value: pr.id, label: pr.name })),
    [projects],
  );

  const focusedRing = useMemo(
    () => (model && focusRing ? model.rings.find((r) => r.key === focusRing) ?? null : null),
    [model, focusRing],
  );
  const focusedSubjectNode = focusSubject ? nodeBySlug.get(focusSubject) ?? null : null;

  const emptyGraph = graph !== null && graph.subjects.length === 0;
  const { width, height } = canvas.size;
  const { x, y, k } = canvas.camera;

  const kindLabel: Record<OmniboxMatch['kind'], string> = {
    category: p.search_kind_category,
    subject: p.search_kind_subject,
    technique: p.search_kind_technique,
    application: p.search_kind_application,
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Toolbar — permanent chrome (loading law: chrome always renders). */}
      <div className="flex-shrink-0 flex items-center gap-3 flex-wrap pb-3">
        <ThemedSelect
          filterable
          hideSearch
          options={projectOptions}
          value={projectId ?? ''}
          onValueChange={pickProject}
          placeholder={p.project_picker_placeholder}
          aria-label={p.project_picker_aria}
          wrapperClassName="w-56"
        />

        <div ref={searchRef} className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            // muted-ok: decorative input glyph, not text
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder={p.search_placeholder}
            aria-label={p.search_placeholder}
            className="w-full rounded-input border border-border/60 bg-secondary/40 pl-8 pr-3 py-1.5 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/50"
          />
          {searchOpen && query.trim().length >= 2 && (
            <div
              className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-72 overflow-y-auto rounded-card border border-border/60 bg-background shadow-elevation-3 p-1"
              role="listbox"
              aria-label={p.search_results_aria}
            >
              {matches.length === 0 ? (
                <p className="typo-caption text-foreground px-2.5 py-2">{p.search_no_matches}</p>
              ) : (
                matches.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => onSearchSelect(m)}
                    className="w-full flex items-center gap-2 text-left rounded-interactive px-2.5 py-1.5 hover:bg-secondary/50 transition-colors"
                  >
                    {/* muted-ok: result-kind micro-label, structural chrome */}
                    <span className="typo-caption text-foreground/50 uppercase tracking-wide w-20 flex-shrink-0">
                      {kindLabel[m.kind]}
                    </span>
                    <span className="typo-body text-foreground truncate">{m.label}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Laws lens — the slot ProjectFilter occupied on the old graph. */}
        <div ref={lawsRef} className="relative">
          <button
            type="button"
            onClick={() => setLawsOpen((o) => !o)}
            aria-expanded={lawsOpen}
            aria-label={p.laws_lens_aria}
            className={`typo-label flex items-center gap-1.5 rounded-interactive border px-2.5 py-1 transition-colors ${
              lawId
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-border/60 bg-secondary/50 text-foreground/70 hover:text-foreground'
            }`}
          >
            <Scale className="w-3.5 h-3.5" aria-hidden />
            {lawId ?? p.laws_lens_label}
            {lawId && (
              <X
                className="w-3 h-3"
                aria-hidden
                onClick={(e) => {
                  e.stopPropagation();
                  setLawId(null);
                }}
              />
            )}
          </button>
          {lawsOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-[360px] max-h-80 overflow-y-auto rounded-card border border-border/60 bg-background shadow-elevation-3 p-1.5">
              {lawId && (
                <button
                  type="button"
                  onClick={() => {
                    setLawId(null);
                    setLawsOpen(false);
                  }}
                  className="w-full text-left typo-caption rounded-interactive px-2 py-1.5 text-foreground hover:bg-secondary/50 transition-colors"
                >
                  {p.laws_lens_clear}
                </button>
              )}
              {(graph?.laws ?? []).length === 0 && (
                <p className="typo-caption text-foreground px-2 py-1.5">{p.laws_lens_empty}</p>
              )}
              {(graph?.laws ?? []).map((law) => {
                const citing = model?.laws.subjectsByLaw.get(law.id)?.size ?? 0;
                const active = lawId === law.id;
                const row = (
                  <button
                    key={law.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setLawId(active ? null : law.id);
                      setLawsOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 text-left rounded-interactive px-2 py-1.5 transition-colors ${
                      active ? 'bg-accent/10 text-accent' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <span className="typo-body text-foreground truncate flex-1">{law.title}</span>
                    <span className="typo-caption text-foreground tabular-nums flex-shrink-0">
                      {tx(p.laws_lens_citing, { count: citing })}
                    </span>
                  </button>
                );
                return law.summary ? (
                  <Tooltip key={law.id} content={law.summary}>
                    {row}
                  </Tooltip>
                ) : (
                  row
                );
              })}
            </div>
          )}
        </div>

        {graph && !emptyGraph && (
          // muted-ok: toolbar counts readout, structural micro-label
          <span className="typo-caption text-foreground/50 whitespace-nowrap">
            {tx(p.counts_readout, {
              subjects: graph.counts.subjects,
              techniques: graph.counts.techniques,
              applications: graph.counts.applications,
            })}
          </span>
        )}

        {graph && <CorpusWarningsBadge warnings={graph.warnings} />}
      </div>

      {/* A fetch failure with a warm copy keeps the warm copy under an honest
          notice — failure is never dressed as empty. */}
      {error && (
        <div className="flex-shrink-0 flex items-center gap-2 rounded-card border border-status-warning/30 bg-status-warning/10 px-3 py-2 mb-3">
          <span className="typo-caption text-status-warning flex-1 truncate">
            {tx(p.fetch_failed, { error })}
          </span>
          <button
            type="button"
            onClick={refetch}
            className="typo-caption rounded-interactive px-2 py-1 text-status-warning hover:bg-status-warning/20 transition-colors"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <IllustratedEmptyState
            variant="routines"
            heading={p.no_projects_title}
            description={p.no_projects_desc}
          />
        </div>
      ) : emptyGraph ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <IllustratedEmptyState
            variant="routines"
            heading={p.empty_graph_title}
            description={graph?.source.reason ?? p.empty_graph_desc}
          />
        </div>
      ) : (
        <div
          ref={canvas.containerRef}
          className="relative flex-1 min-h-0 rounded-card border border-border/60 bg-secondary/20 overflow-hidden"
          style={{ cursor: canvas.isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          {/* Calm centered ghost crest while the graph loads — never a spinner. */}
          {loading && !graph && (
            <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-24 h-24 rounded-full border border-border/60 bg-secondary/40 animate-fade-in"
                style={{ animationDelay: '150ms' }}
              />
            </div>
          )}

          {width > 0 && model && layout && graph && (
            <svg
              ref={canvas.svgRef}
              width={width}
              height={height}
              {...canvas.handlers}
              onDoubleClick={flyHome}
              role="img"
              aria-label={p.graph_canvas_aria}
            >
              <g transform={`translate(${width / 2 + x},${height / 2 + y}) scale(${k})`}>
                <HierarchyNexus
                  model={model}
                  layout={layout}
                  k={k}
                  crestTitle={projectName}
                  crestSub={tx(p.graph_crest_counts, {
                    subjects: graph.counts.subjects,
                    techniques: graph.counts.techniques,
                  })}
                  hoverRing={hoverRing}
                  focusRing={focusRing}
                  focusSubject={focusSubject}
                  highlightTechnique={highlightTechnique}
                  lawLens={lawLens}
                  onHoverRing={setHoverRing}
                  onFocusRing={focusRingOn}
                  onFocusSubject={focusSubjectOn}
                  onSelectTechnique={(node, entry) => setTechniqueModal({ node, entry })}
                />
              </g>
            </svg>
          )}

          {/* Breadcrumb — the way back out of a focus. */}
          {focusedRing && (
            <div
              className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-interactive border border-border/70 bg-background/90 backdrop-blur-sm px-2 py-1 shadow-elevation-1 animate-fade-in"
              aria-label={p.graph_breadcrumb_aria}
            >
              <button
                type="button"
                onClick={flyHome}
                // muted-ok: breadcrumb root affordance, structural chrome
                className="typo-label text-foreground/70 hover:text-foreground transition-colors"
              >
                {projectName}
              </button>
              {/* muted-ok: decorative breadcrumb separator glyph, not text */}
              <ChevronRight className="w-3 h-3 text-foreground/40" aria-hidden />
              <span
                className="typo-label px-1.5 py-0.5 rounded-interactive"
                style={{ color: categoryGraphTheme(focusedRing.id).stroke }}
              >
                {focusedRing.key === UNASSIGNED_RING ? p.category_unassigned : focusedRing.title}
              </span>
              {focusedSubjectNode && (
                <>
                  {/* muted-ok: decorative breadcrumb separator glyph, not text */}
                  <ChevronRight className="w-3 h-3 text-foreground/40" aria-hidden />
                  <span className="typo-label px-1.5 py-0.5 rounded-interactive text-foreground">
                    {focusedSubjectNode.subject.title}
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={flyHome}
                aria-label={p.graph_back_home_aria}
                // muted-ok: dismiss glyph affordance, structural chrome
                className="ml-0.5 text-foreground/50 hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <StatusLegend />
          <ZoomRail k={k} zoomBy={canvas.zoomBy} reset={flyHome} />
        </div>
      )}

      {techniqueModal && projectId && graph && (
        <TechniqueModal
          key={`${techniqueKey(techniqueModal.entry.tech)}@${techniqueModal.node.subject.slug}`}
          projectId={projectId}
          graph={graph}
          node={techniqueModal.node}
          entry={techniqueModal.entry}
          onLinkHref={handleLinkHref}
          onOpenLaw={(id) => setDocViewer({ file: LAWS_FILE, anchor: id })}
          onOpenDoc={(file, anchor) => setDocViewer({ file, anchor })}
          onOpenInSubjects={(slug, technique) => {
            setTechniqueModal(null);
            onOpenInSubjects(slug, technique);
          }}
          onClose={() => setTechniqueModal(null)}
        />
      )}

      {docViewer && projectId && (
        <DocViewer
          projectId={projectId}
          relPath={docViewer.file}
          anchor={docViewer.anchor}
          onClose={() => setDocViewer(null)}
        />
      )}
    </div>
  );
}
