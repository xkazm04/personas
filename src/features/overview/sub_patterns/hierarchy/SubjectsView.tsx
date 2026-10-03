// Subjects lane host — toolbar (project source picker · search omnibox ·
// counts readout · corpus-health warnings badge) over the master–detail
// split. The hierarchy is filesystem-truth read from ONE managed repo, so
// the picker chooses WHICH repo is the knowledge source (persisted per
// device); an empty graph renders `source.reason` as prose with the picker
// prominent — never a spinner, never a crash.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

import { CorpusWarningsBadge } from './CorpusWarningsBadge';
import { DocViewer } from './DocViewer';
import { SubjectsCodex } from './variants/SubjectsCodex';
import type { SubjectsVariantProps } from './variants/shared';
import {
  buildHierarchyIndex,
  groupSubjectsByCategory,
  resolveDocLink,
  searchHierarchy,
  subjectMatchMap,
} from './hierarchyModel';
import { initialHierarchyProjectId, persistHierarchyProjectId } from './projectSource';
import { subjectScoreMap } from './scorecardModel';
import type { DetailFocus } from './variants/shared';
import { useHierarchyGraph } from './useHierarchyGraph';
import { useHierarchyScorecard } from './useHierarchyScorecard';

/** The one place a law CHIP (id-only, no href) resolves to a path. Links in
 *  markdown resolve through `resolveDocLink` instead. Falls back to the
 *  personas layout when the graph is absent; a registry-shaped corpus carries
 *  `_laws.md` inside its bundle (`source.corpusRel`). */
const LAWS_FILE_FALLBACK = 'docs/concepts/paths/_laws.md';

/** Calm bar, the one shape this module's ghost is built from. */
function GhostBar({ w, h = 10, delay }: { w: string; h?: number; delay: number }) {
  return (
    <span
      className="block rounded-card bg-primary/[0.06] animate-fade-in"
      style={{ width: w, height: h, animationDelay: `${120 + delay * 35}ms` }}
    />
  );
}

/**
 * The lane's own delayed ghost (docs/design/overview-loading.md §C): the shelf
 * rail and one document column in the SAME geometry `SubjectsCodex` renders —
 * the 248px bordered nav, then the `px-8 py-8` article. Invisible for the first
 * 120ms, calm, never a pulse, `aria-hidden`. It replaces the empty bordered box
 * this branch used to paint, which was a loading state that said nothing.
 */
function SubjectsGhost() {
  return (
    <div className="flex-1 min-h-0 flex rounded-card border border-border/40 bg-background/40 overflow-hidden" aria-hidden="true">
      <div className="w-[248px] flex-shrink-0 border-r border-border/40 py-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="px-3 py-2">
            <GhostBar w={['58%', '42%', '66%', '48%', '60%', '38%'][i]!} delay={i} />
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0 px-8 py-8">
        <div className="max-w-[72ch] flex flex-col gap-3">
          <GhostBar w="28%" h={8} delay={1} />
          <GhostBar w="62%" h={20} delay={2} />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <GhostBar key={i} w={['96%', '88%', '92%', '74%', '90%', '84%', '58%'][i]!} delay={3 + i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SubjectsView() {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const addToast = useToastStore((s) => s.addToast);
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  // `projectsLoading` has existed in devToolsProjectSlice since before this lane
  // and was never read here, so the "no projects" state asserted itself over an
  // unanswered read. The store flag alone is still false on the FIRST frame —
  // before the effect below has dispatched the fetch — so it is paired with a
  // local "the read has come back" latch, which is the only thing that can see
  // that window. Together they are the lane's `isFetching`.
  const projectsLoading = useSystemStore((s) => s.projectsLoading);
  const [projectsSettled, setProjectsSettled] = useState(false);

  useEffect(() => {
    if (projects.length > 0) return;
    let alive = true;
    void Promise.resolve(fetchProjects()).finally(() => { if (alive) setProjectsSettled(true); });
    return () => { alive = false; };
  }, [projects.length, fetchProjects]);

  const projectIds = useMemo(() => projects.map((pr) => pr.id), [projects]);
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialHierarchyProjectId(projectIds),
  );

  // Projects can hydrate after mount — adopt the persisted/first id once real.
  useEffect(() => {
    if (projectId === null || !projectIds.includes(projectId)) {
      setProjectId(initialHierarchyProjectId(projectIds));
    }
  }, [projectIds, projectId]);

  const pickProject = useCallback((id: string) => {
    setProjectId(id);
    persistHierarchyProjectId(id);
  }, []);

  // `useHierarchyGraph` documents its own `loading` as "the view ghosts only
  // when `loading && !graph`" (useHierarchyGraph.ts:25-26) and this view never
  // destructured it, so the hook's contract went unfulfilled for its only
  // caller.
  const { graph, loading: graphLoading, error, refetch } = useHierarchyGraph(projectId);
  // OPTIONAL census signal — the whole lane renders fully without it.
  const { scorecard } = useHierarchyScorecard(projectId);
  const adherence = useMemo(() => subjectScoreMap(scorecard), [scorecard]);

  const groups = useMemo(() => (graph ? groupSubjectsByCategory(graph) : []), [graph]);
  const index = useMemo(() => (graph ? buildHierarchyIndex(graph) : []), [graph]);

  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchHierarchy(index, query), [index, query]);
  const matchMap = useMemo(
    () => (query.trim().length >= 2 ? subjectMatchMap(matches) : null),
    [matches, query],
  );

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [focus, setFocus] = useState<DetailFocus | null>(null);
  const [docViewer, setDocViewer] = useState<{ file: string; anchor: string | null } | null>(null);

  // Default selection: first subject of the first group once the graph lands
  // (and re-validate when the project switches away from the current slug).
  useEffect(() => {
    if (!graph) return;
    if (selectedSlug && graph.subjects.some((s) => s.slug === selectedSlug)) return;
    setSelectedSlug(groups[0]?.subjects[0]?.slug ?? null);
    setFocus(null);
  }, [graph, groups, selectedSlug]);

  const selectSubject = useCallback((slug: string) => {
    setSelectedSlug(slug);
    setFocus(null);
  }, []);

  // Relative-link interception: resolve against the doc the click happened in,
  // then route. An unresolvable link surfaces honestly as a one-line toast.
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
          setSelectedSlug(target.subject);
          setFocus(null);
          break;
        case 'technique':
          setSelectedSlug(target.subject);
          setFocus({ kind: 'technique', technique: target.technique });
          break;
        case 'application':
          setSelectedSlug(target.subject);
          setFocus({ kind: 'application', file: target.file });
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
    [graph, addToast, p.link_not_in_hierarchy],
  );

  const projectOptions = useMemo(
    () => projects.map((pr) => ({ value: pr.id, label: pr.name })),
    [projects],
  );

  const emptyGraph = graph !== null && graph.subjects.length === 0;
  // The two cold states this lane can be in, each retired by its OWN read
  // (law 6): the project list, then that project's graph. Neither empty state
  // may paint over an unanswered read.
  const projectsCold = projects.length === 0 && (projectsLoading || !projectsSettled);
  const graphCold = graph === null && graphLoading;

  // Law chips resolve inside whichever corpus the graph was read from.
  const lawsFile = graph?.source.corpusRel
    ? `${graph.source.corpusRel}/_laws.md`
    : LAWS_FILE_FALLBACK;

  const variantProps: SubjectsVariantProps | null =
    graph && projectId
      ? {
          projectId,
          graph,
          groups,
          selectedSlug,
          onSelect: selectSubject,
          matchMap,
          scorecard,
          adherence,
          focus,
          onLinkHref: handleLinkHref,
          onOpenDoc: (file, anchor) => setDocViewer({ file, anchor }),
          onOpenLaw: (lawId) => setDocViewer({ file: lawsFile, anchor: lawId }),
        }
      : null;

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

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            // muted-ok: decorative input glyph, not text
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={p.search_placeholder}
            aria-label={p.search_placeholder}
            className="w-full rounded-input border border-border/60 bg-secondary/40 pl-8 pr-3 py-1.5 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/50"
          />
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
          <AlertTriangle className="w-4 h-4 text-status-warning flex-shrink-0" aria-hidden />
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

      {projectsCold || graphCold ? (
        <SubjectsGhost />
      ) : projects.length === 0 ? (
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
      ) : variantProps ? (
        <SubjectsCodex {...variantProps} />
      ) : (
        /* No graph and no fetch in flight (an unresolved project id, or a
           failure whose notice is above): the box keeps the lane's geometry. */
        <div className="flex-1 min-h-0 flex rounded-card border border-border/40 bg-background/40 overflow-hidden" />
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
