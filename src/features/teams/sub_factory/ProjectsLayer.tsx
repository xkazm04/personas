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
 *  repo favicons don't change mid-session; remounts must not re-probe N repos. */
const FAVICON_CACHE = new Map<string, string | null>();

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
        setHeaderStats(new Map(rows.map((r) => [r.project_id, {
          contexts: r.contexts_count,
          kpiPassed: r.active_kpis.filter((k) => kpiTrack(k) === 'met').length,
          kpiTotal: r.active_kpis.length,
        }])));
        // Full DevMilestone rows in, unchanged builder contract out.
        setRoadmapBySlug(new Map(rows.map((r) => [r.project_id, buildCoverRoadmap(r.milestones)])));
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
// `loading` is already false. Geometry mirrors WallOverviewGrid's default
// view: a 2/3-column grid of cover tiles, each with an identity-row
// silhouette, a 5-cell statband silhouette, and a blockers-footer bar.
// `animate-fade-in` + a ≥120ms staggered delay keeps it invisible on a fast
// load (law 3); no `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TILE_COUNT = 4;

function PassportWallGhost() {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3" aria-hidden="true">
      {Array.from({ length: GHOST_TILE_COUNT }).map((_, i) => {
        const delay = `${120 + i * 35}ms`;
        return (
          <div
            key={i}
            className="rounded-modal p-4 min-w-0 bg-secondary/[0.03] shadow-elevation-1 animate-fade-in"
            style={{ border: '1px solid rgba(148,163,184,.14)', animationDelay: delay }}
          >
            {/* identity row: status dot + name + stack strip */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-primary/[0.10] shrink-0" />
              <span className={`h-3.5 w-24 ${GHOST_BAR}`} />
              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                {Array.from({ length: 5 }).map((__, j) => (
                  <span key={j} className="w-3.5 h-3.5 rounded-[3px] bg-primary/[0.05]" />
                ))}
              </span>
            </div>
            {/* statband: 5 labeled cells */}
            <div
              className="mt-2.5 flex items-center justify-between rounded-card px-2.5 py-1.5"
              style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.10)' }}
            >
              {Array.from({ length: 5 }).map((__, j) => (
                <span key={j} className="flex flex-col items-center gap-1 min-w-0">
                  <span className={`h-2.5 w-6 ${GHOST_BAR}`} />
                  <span className="h-1.5 w-5 rounded bg-primary/[0.04]" />
                </span>
              ))}
            </div>
            {/* blockers footer row */}
            <div className="mt-3 pt-2.5 border-t border-dashed border-foreground/10">
              <span className={`block h-2.5 w-32 ${GHOST_BAR}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
