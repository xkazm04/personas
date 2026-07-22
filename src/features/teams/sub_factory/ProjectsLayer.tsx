// L1 projects overview — the project-readiness MATRIX. Each dev_tools project is
// a column (horizontal scroll, name-ascending); App Readiness Passport items are
// the rows (Stack / Tooling / Readiness-for-full-automation), compared side by
// side. Passport data is derived live from the cross-project scan + project
// config (see usePassportData). "Rescan" re-runs that scan and re-derives.
//
// The Passport Wall is the production baseline here — the earlier KPI-health
// Cards and the Heat-grid prototype were consolidated out (2026-06-21).
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Target } from 'lucide-react';

import { listContexts } from '@/api/devTools/devTools';
import { listKpis } from '@/api/devTools/kpis';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ProjectsPassportWall } from './passport';
import type { WarningItem } from './passport/WarningBadge';
import { ImproveProvider } from './passport/improve/ImproveContext';
import { ImprovePlanPanel } from './passport/improve/ImprovePlanPanel';
import { useImproveEngine } from './passport/improve/useImproveEngine';
import { usePassportData } from './passport/usePassportData';
import { useFactoryData } from './factoryData';
import { collectKpiAttention } from './factoryModel';

export function ProjectsLayer({
  onOpen,
  onJumpKpi,
}: {
  onOpen: (id: string) => void;
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
}) {
  const { passports, rawByProject, loading, error, generatedAt, rescanning, rescan, reload } = usePassportData();
  const { projects: factoryProjects } = useFactoryData();
  const [showPlan, setShowPlan] = useState(false);
  const openSlugs = useMemo(() => new Set(passports.map((p) => p.identity.slug)), [passports]);

  // Improve engine — lets actionable cells project + apply Tier-0 standards
  // upgrades. Extracted to useImproveEngine (shared with the Mastermind canvas).
  const improve = useImproveEngine(rawByProject, reload);

  // R18 — the Statband cover's volume stats: contexts count + KPI pass rate per
  // project. Fetched once per passport set (2 light IPC calls per project);
  // covers render dim placeholders until it lands.
  const [headerStats, setHeaderStats] = useState<Map<string, { contexts: number; kpiPassed: number; kpiTotal: number }>>(new Map());
  useEffect(() => {
    if (passports.length === 0) return;
    let alive = true;
    void Promise.all(
      passports.map(async (p) => {
        const slug = p.identity.slug;
        const [ctxs, kpis] = await Promise.all([listContexts(slug), listKpis(slug)]);
        const active = kpis.filter((k) => k.status === 'active');
        const passed = active.filter((k) => kpiTrack(k) === 'met').length;
        return [slug, { contexts: ctxs.length, kpiPassed: passed, kpiTotal: active.length }] as const;
      }),
    )
      .then((entries) => { if (alive) setHeaderStats(new Map(entries)); })
      .catch(silentCatch('ProjectsLayer:headerStats'));
    return () => { alive = false; };
  }, [passports]);

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
        <div className="inline-flex items-center gap-2">
          {passports.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Target className="w-3.5 h-3.5" />}
              onClick={() => setShowPlan(true)}
            >
              Improve plan
            </Button>
          )}
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            loading={rescanning}
            onClick={rescan}
          >
            Rescan
          </Button>
        </div>
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
          <ProjectsPassportWall passports={passports} openSlugs={openSlugs} onOpen={onOpen} attentionByProject={attentionByProject} onJumpKpi={onJumpKpi} headerStats={headerStats} />
          <ImprovePlanPanel open={showPlan} onClose={() => setShowPlan(false)} />
        </ImproveProvider>
      )}
    </div>
  );
}
