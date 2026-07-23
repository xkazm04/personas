// L1 projects overview — the project-readiness MATRIX. Each dev_tools project is
// a column (horizontal scroll, name-ascending); App Readiness Passport items are
// the rows (Stack / Tooling / Readiness-for-full-automation), compared side by
// side. Passport data is derived live from the cross-project scan + project
// config (see usePassportData). "Rescan" re-runs that scan and re-derives.
//
// The Passport Wall is the production baseline here — the earlier KPI-health
// Cards and the Heat-grid prototype were consolidated out (2026-06-21).
import { useEffect, useMemo, useState } from 'react';

import { listContexts, getProjectFavicon } from '@/api/devTools/devTools';
import { listKpis } from '@/api/devTools/kpis';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ProjectsPassportWall } from './passport';
import type { WarningItem } from './passport/WarningBadge';
import { ImproveProvider } from './passport/improve/ImproveContext';
import { useImproveEngine } from './passport/improve/useImproveEngine';
import { mapWithConcurrency, usePassportData } from './passport/usePassportData';
import { useFactoryData } from './factoryData';
import { collectKpiAttention } from './factoryModel';

/** root_path → favicon data URL (null = probed, none found). Module scope —
 *  repo favicons don't change mid-session; remounts must not re-probe N repos. */
const FAVICON_CACHE = new Map<string, string | null>();

export function ProjectsLayer({
  onOpen,
  onJumpKpi,
}: {
  onOpen: (id: string) => void;
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const { passports, rawByProject, loading, error, generatedAt, rescanningProject, rescanProject, reload } = usePassportData();
  const { projects: factoryProjects } = useFactoryData();
  const openSlugs = useMemo(() => new Set(passports.map((p) => p.identity.slug)), [passports]);

  // Improve engine — lets actionable cells project + apply Tier-0 standards
  // upgrades. Extracted to useImproveEngine (shared with the Mastermind canvas).
  const improve = useImproveEngine(rawByProject, reload);

  // R18 — the Statband cover's volume stats: contexts count + KPI pass rate per
  // project. Fetched once per passport set (2 light IPC calls per project);
  // covers render dim placeholders until it lands.
  const [headerStats, setHeaderStats] = useState<Map<string, { contexts: number; kpiPassed: number; kpiTotal: number }>>(new Map());
  // Keyed on the SLUG SET, not the passports array identity — usePassportData
  // publishes multiple phases per load (0/1/2), and keying on identity re-ran
  // this N×2-IPC fan-out once per phase. Bounded concurrency for 30+ projects.
  const slugsKey = useMemo(() => passports.map((p) => p.identity.slug).sort().join('|'), [passports]);
  useEffect(() => {
    if (slugsKey === '') return;
    const slugs = slugsKey.split('|');
    let alive = true;
    void mapWithConcurrency(slugs, 5, async (slug) => {
      const [ctxs, kpis] = await Promise.all([listContexts(slug), listKpis(slug)]);
      const active = kpis.filter((k) => k.status === 'active');
      const passed = active.filter((k) => kpiTrack(k) === 'met').length;
      return [slug, { contexts: ctxs.length, kpiPassed: passed, kpiTotal: active.length }] as const;
    })
      .then((entries) => { if (alive) setHeaderStats(new Map(entries)); })
      .catch(silentCatch('ProjectsLayer:headerStats'));
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
        url = await getProjectFavicon(root).catch(() => null);
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
          {passports.length > 0 && <span className="typo-caption">{passports.length} projects</span>}
          {generatedAt && (
            <span className="typo-caption inline-flex items-center gap-1">
              · scanned <RelativeTime timestamp={generatedAt} className="tabular-nums" />
            </span>
          )}
        </div>
        {/* Rescan + Improve plan moved into the wall's per-project actions row
            (Stack group header line) — scoped per project, consent-gated. */}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner label="Deriving project passports…" />
        </div>
      ) : error ? (
        <div className="rounded-card border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4">
          <p className="typo-title mb-1">Couldn't build project passports</p>
          <p className="typo-caption">{error}</p>
        </div>
      ) : passports.length === 0 ? (
        <div className="rounded-card border border-primary/15 bg-secondary/10 p-8 text-center">
          <p className="typo-title-lg mb-1">No projects to compare yet</p>
          <p className="typo-caption">Register a project in Dev-Tools and scan its context map, then Rescan to build its readiness passport.</p>
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
            rescanningProject={rescanningProject}
            onRescanProject={rescanProject}
          />
        </ImproveProvider>
      )}
    </div>
  );
}
