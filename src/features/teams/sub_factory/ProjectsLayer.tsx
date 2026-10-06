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
import { KitHost, Meta, Section, Segmented, Surface } from '@/features/shared/components/kit';
import { ProjectsPassportWall } from './passport';
import { PassportAtlas } from './passport/atlas/PassportAtlas';
import { AtlasFavicons } from './passport/atlas/atlasFavicons';
import { ATLAS_WORDS } from './passport/atlas/atlasWords';
import { buildCoverRoadmap, type CoverRoadmapVM } from './passport/CoverRoadmap';
import type { WarningItem } from './passport/WarningBadge';
import { ImproveProvider } from './passport/improve/ImproveContext';
import { useImproveEngine } from './passport/improve/useImproveEngine';
import { mapWithConcurrency, usePassportData } from './passport/usePassportData';
import { useAutoRescanOnFleetExit } from './passport/useAutoRescanOnFleetExit';
import { useFactoryData } from './factoryData';
import { collectKpiAttention } from './factoryModel';
import { PassportWallGhost } from './PassportWallGhost';
import { useFactoryWords } from './useFactoryWords';

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
  /** Raises the Notepad filtered to this project — the cover's minimized
   *  roadmap strip. Named for the door, not the destination: the Ship tab it
   *  used to open was retired on 2026-09-15. */
  onOpenShip?: (id: string) => void;
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const w = useFactoryWords();
  // The Passport Atlas (contest winner, 2026-09-25) runs beside the legacy wall
  // until it has been perfected; the wall is then descoped.
  const [view, setView] = useState<'atlas' | 'wall'>('atlas');
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

  // R21 — real app favicons for the covers and the Atlas tiles (probed from
  // each project's repo); both fall back where none exists.
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

  // The head is a kit Section at the REAL type tier.
  //
  // It was `KitHost compact`, which is `data-type-density="compact"` - measured
  // at 11.1-12.5% smaller than the same token outside the kit
  // (`scripts/style/kit-type-probe/`). Doctrine 6c reserves that tier for dense
  // tool lists; this is the Factory's landing showcase, so it was the exact case
  // the doctrine names. It also CAUSED the deviation that used to be annotated
  // here: the wall below had to hold its own tier to stay on the same reading
  // line as a head that had shrunk away from it. Dropping `compact` puts both on
  // one ladder and retires the deviation rather than documenting it.
  //
  // `Surface dense` stays - it is padding only (`k-surface--dense`), not type,
  // so the head band keeps its tight rhythm.
  const failed = !!error && passports.length === 0;
  const empty = !failed && !loading && passports.length === 0;
  return (
    // The head and the wall used to butt together with no gap at all.
    <div className="space-y-3">
      <KitHost testId="factory-landing">
        <Surface dense>
          <Section
            id="s-fac-readiness"
            eyebrow={w.eyebrow}
            title={w.L.readiness}
            count={passports.length > 0 ? passports.length : undefined}
            meta={generatedAt ? <Meta parts={[<span key="s">{w.L.scanned} <RelativeTime timestamp={generatedAt} className="tabular-nums" /></span>]} /> : undefined}
            actions={passports.length > 0 ? (
              <Segmented
                label={ATLAS_WORDS.tabsLabel}
                value={view}
                onChange={setView}
                options={[{ v: 'atlas', label: ATLAS_WORDS.tabAtlas }, { v: 'wall', label: ATLAS_WORDS.tabWall }]}
              />
            ) : undefined}
            state={failed || empty ? 'empty' : undefined}
            empty={failed
              ? { title: w.L.passportsFailed, hint: error, tone: 'error' }
              : { title: w.L.noProjects, hint: w.L.noProjectsHint, tone: 'info' }}
          />
        </Surface>
      </KitHost>
      {/* Rescan + Improve plan live in the wall's per-project actions row. */}
      {loading && passports.length === 0 ? (
        <PassportWallGhost />
      ) : passports.length > 0 && (
        <ImproveProvider value={improve}>
          {view === 'atlas' ? (
            // The Atlas matrix's project tiles read the same probed favicons.
            <AtlasFavicons.Provider value={faviconBySlug}>
              <PassportAtlas
                passports={passports}
                onOpen={onOpen}
                rescanningProject={rescanningProject}
                onRescanProject={rescanProject}
              />
            </AtlasFavicons.Provider>
          ) : (
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
          )}
        </ImproveProvider>
      )}
    </div>
  );
}
