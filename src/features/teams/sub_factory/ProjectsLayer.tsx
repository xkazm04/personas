// L1 projects overview — the project-readiness MATRIX. Each dev_tools project is
// a column (horizontal scroll, name-ascending); App Readiness Passport items are
// the rows (Stack / Tooling / Readiness-for-full-automation), compared side by
// side. Passport data is derived live from the cross-project scan + project
// config (see usePassportData). "Rescan" re-runs that scan and re-derives.
//
// The Passport Wall is the production baseline here — the earlier KPI-health
// Cards and the Heat-grid prototype were consolidated out (2026-06-21).
import { useMemo, useState } from 'react';
import { RefreshCw, Target } from 'lucide-react';

import { setStandardsConfig, scanCodebase, createTask, executeTask, updateProject, installSkill } from '@/api/devTools/devTools';
import { useOverviewStore } from '@/stores/overviewStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ProjectsPassportWall } from './passport';
import type { WarningItem } from './passport/WarningBadge';
import { ImproveProvider, type ImproveEngine } from './passport/improve/ImproveContext';
import { ImprovePlanPanel } from './passport/improve/ImprovePlanPanel';
import { usePassportData } from './passport/usePassportData';
import { useFactoryData } from './factoryData';
import { groupKpis, kpiStatus } from './factoryMock';

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

  // Improve engine — lets actionable cells project + apply Tier-0 standards upgrades.
  const improve = useMemo<ImproveEngine>(() => ({
    getRaw: (slug) => rawByProject.get(slug),
    allRaw: () => [...rawByProject.values()],
    applyStandards: async (slug, json) => { await setStandardsConfig(slug, json); reload(); },
    runContextScan: async (slug) => {
      const raw = rawByProject.get(slug);
      if (!raw) return undefined;
      const { scan_id } = await scanCodebase(slug, raw.project.root_path);
      // Register in the global activity dock (titlebar) so the scan stays
      // visible while the user navigates across modules; completion is resolved
      // globally in eventBridge (CONTEXT_GEN_COMPLETE → factory_scan). The Rust
      // side runs the scan detached, so scanCodebase returns a scan_id at once.
      useOverviewStore.getState().processStarted(
        'factory_scan',
        scan_id,
        `Context scan: ${raw.project.name}`,
        { section: 'plugins', tab: 'context-map' },
      );
      return scan_id;
    },
    bindConnector: async (slug, credId, field) => {
      await updateProject(slug, field === 'pr' ? { prCredentialId: credId } : { monitoringCredentialId: credId });
      reload();
    },
    installSkills: async (slug, items) => {
      await Promise.all(items.map((it) => installSkill(it.name, it.source, slug, false)));
      reload();
    },
    queueTask: async (slug, title, prompt) => { await createTask(title, slug, prompt); },
    deployNow: async (slug, title, prompt) => {
      const raw = rawByProject.get(slug);
      const task = await createTask(title, slug, prompt);
      // Surface the Claude-Code run in the global activity dock keyed by task id,
      // deep-linking to the Task Runner where its output streams live (same
      // surface as every other Claude-Code CLI execution). The run dispatches
      // detached on the Rust side; its terminal status (completed/failed/
      // cancelled) is resolved globally in eventBridge → factory_deploy, which
      // also raises the completion notification, so the user can switch modules
      // and be told when the LLM is done.
      const ov = useOverviewStore.getState();
      ov.processStarted(
        'factory_deploy',
        task.id,
        `Upgrade ${raw?.project.name ?? 'project'}: ${title}`,
        { section: 'plugins', tab: 'task-runner' },
      );
      try {
        await executeTask(task.id);
      } catch (e) {
        // executeTask only rejects on dispatch failure (before any event), so
        // settle the dock entry + un-busy the cell here; in-run terminal states
        // arrive via events.
        ov.processEnded('factory_deploy', 'failed', task.id);
        useImproveActivityStore.getState().endByRun(task.id);
        throw e;
      }
      return task.id;
    },
  }), [rawByProject, reload]);

  // Off-track (crit) KPIs per project — folds the old AttentionBand into the
  // matrix as a per-project warning badge on each cover.
  const attentionByProject = useMemo(() => {
    const m = new Map<string, WarningItem[]>();
    for (const p of factoryProjects) {
      const items: WarningItem[] = [];
      for (const g of p.groups) {
        for (const k of groupKpis(g)) {
          if (kpiStatus(k) === 'crit') {
            items.push({ groupId: g.id, kpiId: k.id, name: k.name, current: k.current, target: k.target, unit: k.unit });
          }
        }
      }
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
          <ProjectsPassportWall passports={passports} openSlugs={openSlugs} onOpen={onOpen} attentionByProject={attentionByProject} onJumpKpi={onJumpKpi} />
          <ImprovePlanPanel open={showPlan} onClose={() => setShowPlan(false)} />
        </ImproveProvider>
      )}
    </div>
  );
}
