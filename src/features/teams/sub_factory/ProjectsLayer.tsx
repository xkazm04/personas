// L1 projects overview — the project-readiness MATRIX. Each dev_tools project is
// a column (horizontal scroll, name-ascending); App Readiness Passport items are
// the rows (Stack / Tooling / Readiness-for-full-automation), compared side by
// side. Passport data is derived live from the cross-project scan + project
// config (see usePassportData). "Rescan" re-runs that scan and re-derives.
//
// The Passport Wall is the production baseline here — the earlier KPI-health
// Cards and the Heat-grid prototype were consolidated out (2026-06-21).
import { useEffect, useMemo, useState } from 'react';

import { getProjectFavicon } from '@/api/devTools/devTools';
import { projectWallSummary } from '@/api/devTools/milestones';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { silentCatch } from '@/lib/silentCatch';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ProjectsPassportWall } from './passport';
import { buildCoverRoadmap, type CoverRoadmapVM } from './passport/CoverRoadmap';
import type { WarningItem } from './passport/WarningBadge';
import { ImproveProvider } from './passport/improve/ImproveContext';
import { useImproveEngine } from './passport/improve/useImproveEngine';
import { mapWithConcurrency, usePassportData } from './passport/usePassportData';
import { useAutoRescanOnFleetExit } from './passport/useAutoRescanOnFleetExit';
import { useFactoryData } from './factoryData';
import { collectKpiAttention } from './factoryModel';

/** root_path → favicon data URL (null = probed, none found). Module scope —
 *  repo favicons don't change mid-session; remounts must not re-probe N repos.
 *  `createModuleCache` bounds it with `maxSize` rather than a bare `Map`
 *  (see docs/concepts/golden-paths/shared-fetch-cache.md §12 item 10). */
const FAVICON_CACHE = createModuleCache<string, string | null>({ maxSize: 32 });

export function ProjectsLayer({
  onOpen,
  onOpenShip,
  onJumpKpi,
}: {
  onOpen: (id: string) => void;
  /** Opens a project on its Ship tab — the cover's minimized roadmap strip. */
  onOpenShip?: (id: string) => void;
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const { passports, rawByProject, loading, error, generatedAt, rescanningProject, rescanProject, reload } = usePassportData();
  // R22 — a finished `passport:*` dispatch auto-verifies via scoped rescan.
  useAutoRescanOnFleetExit(rescanProject);
  const { projects: factoryProjects } = useFactoryData();
  const openSlugs = useMemo(() => new Set(passports.map((p) => p.identity.slug)), [passports]);

  // Improve engine — lets actionable cells project + apply Tier-0 standards
  // upgrades. Extracted to useImproveEngine (shared with the Mastermind canvas).
  const improve = useImproveEngine(rawByProject, reload);

  // R18 — the Statband cover's volume stats (contexts count + KPI pass rate)
  // and the cover's minimized roadmap strip. Both come from ONE batched read:
  // `dev_tools_project_wall_summary` answers the whole wall in a single IPC
  // call backed by three grouped `WHERE project_id IN (…)` queries. This used
  // to be three per-project fan-outs (listContexts + listKpis +
  // listMilestones) through a concurrency pool — 3N round trips, i.e. 90 for a
  // 30-project wall. Covers render dim placeholders until it lands.
  const [headerStats, setHeaderStats] = useState<Map<string, { contexts: number; kpiPassed: number; kpiTotal: number }>>(new Map());
  const [roadmapBySlug, setRoadmapBySlug] = useState<Map<string, CoverRoadmapVM>>(new Map());
  // Keyed on the SLUG SET, not the passports array identity — usePassportData
  // publishes multiple phases per load (0/1/2), and keying on identity re-ran
  // the whole fetch once per phase.
  const slugsKey = useMemo(() => passports.map((p) => p.identity.slug).sort().join('|'), [passports]);
  useEffect(() => {
    if (slugsKey === '') return;
    const slugs = slugsKey.split('|');
    let alive = true;
    void projectWallSummary(slugs)
      .then((rows) => {
        if (!alive) return;
        // KPI "passed" stays a CLIENT computation on the raw active rows —
        // `kpiTrack` is time-dependent (pace against target_date at now) and
        // already has one Rust twin in engine/kpi_derivation.rs; a server-side
        // third copy would drift and would go stale in cache besides.
        setHeaderStats(new Map(rows.map((r) => [r.projectId, {
          contexts: r.contextsCount,
          kpiPassed: r.activeKpis.filter((k) => kpiTrack(k) === 'met').length,
          kpiTotal: r.activeKpis.length,
        }])));
        // Full DevMilestone rows in, unchanged builder contract out.
        setRoadmapBySlug(new Map(rows.map((r) => [r.projectId, buildCoverRoadmap(r.milestones)])));
      })
      .catch(silentCatch('ProjectsLayer:wallSummary'));
    return () => { alive = false; };
  }, [slugsKey]);

  // R21 — real app favicons for the covers (probed from each project's repo);
  // covers fall back to the status dot where none exists.
  const [faviconBySlug, setFaviconBySlug] = useState<Map<string, string>>(new Map());
  // Favicons never change within a session — cache the probe result per
  // root_path at module scope, key the effect on the slug→root signature
  // (identity churns once per publish phase), and bound the FS fan-out.
  const faviconKey = useMemo(
    () => [...rawByProject.entries()].map(([slug, raw]) => `${slug}→${raw.project.root_path ?? ''}`).sort().join('|'),
    [rawByProject],
  );
  useEffect(() => {
    if (faviconKey === '') return;
    const pairs = faviconKey.split('|').map((e) => e.split('→') as [string, string]);
    let alive = true;
    void mapWithConcurrency(pairs, 5, async ([slug, root]) => {
      if (!root) return [slug, null] as const;
      let url = FAVICON_CACHE.get(root);
      if (url === undefined) {
        url = await getProjectFavicon(root).catch((err) => { silentCatch('ProjectsLayer:getProjectFavicon')(err); return null; });
        FAVICON_CACHE.set(root, url);
      }
      return [slug, url] as const;
    })
      .then((entries) => {
        if (!alive) return;
        setFaviconBySlug(new Map(entries.filter((e): e is [string, string] => e[1] !== null)));
      })
      .catch(silentCatch('ProjectsLayer:favicons'));
    return () => { alive = false; };
  }, [faviconKey]);

  // Off-track (crit) KPIs per project — folds the old AttentionBand into the
  // matrix as a per-project warning badge on each cover.
  const attentionByProject = useMemo(() => {
    const m = new Map<string, WarningItem[]>();
    for (const p of factoryProjects) {
      // `collectKpiAttention` is shared with the findings sweep's kpi_offtrack
      // emitter — the badge and the finding must never disagree on "off track".
      const items = collectKpiAttention(p);
      if (items.length > 0) m.set(p.id, items);
    }
    return m;
  }, [factoryProjects]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h2 className="typo-section-title">Project readiness</h2>
          {passports.length > 0 && <span className="typo-body-lg text-foreground/55">{passports.length} projects</span>}
          {generatedAt && (
            <span className="typo-body-lg text-foreground/55 inline-flex items-center gap-1">
              · scanned <RelativeTime timestamp={generatedAt} className="tabular-nums" />
            </span>
          )}
        </div>
        {/* Rescan + Improve plan moved into the wall's per-project actions row
            (Stack group header line) — scoped per project, consent-gated. */}
      </div>

      {loading ? (
        <PassportWallGhost />
      ) : error ? (
        <div className="rounded-card border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4">
          <p className="typo-title-lg mb-1">Couldn't build project passports</p>
          <p className="typo-body-lg text-foreground/60">{error}</p>
        </div>
      ) : passports.length === 0 ? (
        <div className="rounded-card border border-primary/15 bg-secondary/10 p-8 text-center">
          <p className="typo-title-lg mb-1">No projects to compare yet</p>
          <p className="typo-body-lg text-foreground/60">Register a project in Dev-Tools and scan its context map, then Rescan to build its readiness passport.</p>
        </div>
      ) : (
        <ImproveProvider value={improve}>
          <ProjectsPassportWall
            passports={passports}
            openSlugs={openSlugs}
            onOpen={onOpen}
            attentionByProject={attentionByProject}
            onJumpKpi={onJumpKpi}
            headerStats={headerStats}
            faviconBySlug={faviconBySlug}
            roadmapBySlug={roadmapBySlug}
            onOpenShip={onOpenShip}
            rescanningProject={rescanningProject}
            onRescanProject={rescanProject}
          />
        </ImproveProvider>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PassportWallGhost — calm delayed ghost of the passport WALL (loading
// choreography v2, docs/design/overview-loading.md). Cold loads (no cached
// snapshot yet — see usePassportData's module-scope cachedSnapshot) show this
// instead of a whole-region spinner; warm remounts skip it entirely since
// `loading` is already false.
//
// Geometry mirrors WallCompareTable, which is the wall's ONLY view since the
// Overview grid was removed (2026-08-27): the bordered matrix shell, a sticky
// 190px label rail, and N 236px cover columns above a band of dimension rows.
// It used to mirror the grid's 2/3-column tiles, so it ghosted a shape the
// settled render could no longer produce — the one way a ghost lies.
//
// `animate-fade-in` + a >=120ms staggered delay keeps it invisible on a fast
// load (law 3); no `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Cover columns drawn. Four is what fits a desk window before the matrix
 *  scrolls horizontally — past that the ghost would draw off-screen. */
const GHOST_COL_COUNT = 4;
/** Dimension rows drawn under the covers. Enough to read as a matrix; the real
 *  table has ~40 and ghosting all of them is paint nobody sees. */
const GHOST_ROW_COUNT = 6;

/** The compare table's own rail/column widths — kept literal here rather than
 *  imported, because these are the ghost's geometry contract and a shared
 *  constant would invite the table to change them without a ghost to match. */
const GHOST_RAIL = 'w-[190px] min-w-[190px]';
const GHOST_COL = 'w-[236px] min-w-[236px]';

function PassportWallGhost() {
  const cols = Array.from({ length: GHOST_COL_COUNT });
  return (
    <div
      className="overflow-hidden rounded-modal border border-primary/[0.08] bg-secondary/[0.03] shadow-elevation-1"
      aria-hidden="true"
    >
      {/* cover header band — one silhouette per project column */}
      <div className="flex border-b-2 border-primary/15">
        <div className={`${GHOST_RAIL} px-3 py-3`}>
          <span className={`block h-2.5 w-16 ${GHOST_BAR}`} />
        </div>
        {cols.map((_, i) => (
          <div
            key={i}
            className={`${GHOST_COL} animate-fade-in border-l border-primary/[0.08] px-3 py-3`}
            style={{ borderTop: '2px solid rgba(148,163,184,.14)', animationDelay: `${120 + i * 35}ms` }}
          >
            {/* identity row: status dot + name + stack strip */}
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary/[0.10]" />
              <span className={`h-3.5 w-20 ${GHOST_BAR}`} />
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {Array.from({ length: 3 }).map((__, j) => (
                  <span key={j} className="h-3.5 w-3.5 rounded-[3px] bg-primary/[0.05]" />
                ))}
              </span>
            </div>
            {/* statband: 5 labeled cells */}
            <div
              className="mt-2.5 flex items-center justify-between rounded-card px-2.5 py-1.5"
              style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.10)' }}
            >
              {Array.from({ length: 5 }).map((__, j) => (
                <span key={j} className="flex min-w-0 flex-col items-center gap-1">
                  <span className={`h-2.5 w-5 ${GHOST_BAR}`} />
                  <span className="h-1.5 w-4 rounded bg-primary/[0.04]" />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* dimension rows — a section band, then labelled rows across the columns */}
      <div className="animate-fade-in" style={{ animationDelay: '260ms' }}>
        <div className="border-t border-primary/10 bg-primary/[0.03] px-3 py-1.5">
          <span className={`block h-2.5 w-24 ${GHOST_BAR}`} />
        </div>
        {Array.from({ length: GHOST_ROW_COUNT }).map((_, r) => (
          <div key={r} className="flex border-t border-primary/[0.06]">
            <div className={`${GHOST_RAIL} px-3 py-2`}>
              <span className={`block h-2.5 w-28 ${GHOST_BAR}`} />
            </div>
            {cols.map((__, i) => (
              <div key={i} className={`${GHOST_COL} border-l border-primary/[0.08] px-3 py-2`}>
                <span className="block h-2.5 w-16 rounded bg-primary/[0.04]" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
