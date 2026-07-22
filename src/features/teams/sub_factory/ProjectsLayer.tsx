// L1 projects overview — the project-readiness MATRIX. Each dev_tools project is
// a column (horizontal scroll, name-ascending); App Readiness Passport items are
// the rows (Stack / Tooling / Readiness-for-full-automation), compared side by
// side. Passport data is derived live from the cross-project scan + project
// config (see usePassportData). "Rescan" re-runs that scan and re-derives.
//
// The Passport Wall is the production baseline here — the earlier KPI-health
// Cards and the Heat-grid prototype were consolidated out (2026-06-21).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Target } from 'lucide-react';

import { setStandardsConfig, scanCodebase, createTask, executeTask, updateProject, listContexts, getProjectFavicon } from '@/api/devTools/devTools';
import { listKpis } from '@/api/devTools/kpis';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';
import { useOverviewStore } from '@/stores/overviewStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ProjectsPassportWall } from './passport';
import { anchorTip } from './passport/passportInk';
import type { WarningItem } from './passport/WarningBadge';
import { ImproveProvider, type ImproveEngine } from './passport/improve/ImproveContext';
import { ImprovePlanPanel } from './passport/improve/ImprovePlanPanel';
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

  // Improve engine — lets actionable cells project + apply Tier-0 standards upgrades.
  const improve = useMemo<ImproveEngine>(() => ({
    getRaw: (slug) => rawByProject.get(slug),
    allRaw: () => [...rawByProject.values()],
    applyStandards: async (slug, json) => { await setStandardsConfig(slug, json); reload(); },
    runContextScan: async (slug, delta) => {
      const raw = rawByProject.get(slug);
      if (!raw) return undefined;
      // Same dev_tools_scan_codebase path as the Dev-Tools Context Map page —
      // delta=true is its incremental "Re-scan" (only re-derives contexts for
      // files changed since the last scan), delta=false/undefined the full scan.
      const { scan_id } = await scanCodebase(slug, raw.project.root_path, delta);
      // Register in the global activity dock (titlebar) so the scan stays
      // visible while the user navigates across modules; completion is resolved
      // globally in eventBridge (CONTEXT_GEN_COMPLETE → factory_scan). The Rust
      // side runs the scan detached, so scanCodebase returns a scan_id at once.
      useOverviewStore.getState().processStarted(
        'factory_scan',
        scan_id,
        `Context ${delta ? 're-scan' : 'scan'}: ${raw.project.name}`,
        { section: 'plugins', tab: 'context-map' },
      );
      return scan_id;
    },
    bindConnector: async (slug, credId, field) => {
      const updates =
        field === 'pr' ? { prCredentialId: credId }
        : field === 'llm_tracking' ? { llmTrackingCredentialId: credId }
        : { monitoringCredentialId: credId };
      await updateProject(slug, updates);
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

  // R21 — real app favicons for the covers (probed from each project's repo);
  // covers fall back to the status dot where none exists.
  const [faviconBySlug, setFaviconBySlug] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (rawByProject.size === 0) return;
    let alive = true;
    void Promise.all(
      [...rawByProject.entries()].map(async ([slug, raw]) => {
        const url = raw.project.root_path ? await getProjectFavicon(raw.project.root_path) : null;
        return [slug, url] as const;
      }),
    )
      .then((entries) => {
        if (!alive) return;
        setFaviconBySlug(new Map(entries.filter((e): e is [string, string] => e[1] !== null)));
      })
      .catch(silentCatch('ProjectsLayer:favicons'));
    return () => { alive = false; };
  }, [rawByProject]);

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
          <RescanConfirmButton rescanning={rescanning} onConfirm={rescan} />
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
          <ProjectsPassportWall passports={passports} openSlugs={openSlugs} onOpen={onOpen} attentionByProject={attentionByProject} onJumpKpi={onJumpKpi} headerStats={headerStats} faviconBySlug={faviconBySlug} />
          <ImprovePlanPanel open={showPlan} onClose={() => setShowPlan(false)} />
        </ImproveProvider>
      )}
    </div>
  );
}

const RESCAN_CONFIRM_WIDTH = 288;

/** The header Rescan behind a confirm popover — the scan takes a while across a
 *  large fleet, so a stray click shouldn't fire it. Explains what it does. */
function RescanConfirmButton({ rescanning, onConfirm }: { rescanning: boolean; onConfirm: () => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [anchor]);

  const pos = anchor ? anchorTip(anchor, RESCAN_CONFIRM_WIDTH, 150) : null;

  return (
    <>
      <Button
        variant="accent"
        accentColor="violet"
        size="sm"
        icon={<RefreshCw className="w-3.5 h-3.5" />}
        loading={rescanning}
        onClick={(e) => {
          // Read the rect NOW — e.currentTarget is detached by the time a
          // state-updater callback runs.
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAnchor((a) => (a ? null : rect));
        }}
      >
        Rescan
      </Button>
      {anchor && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Confirm rescan"
          style={{ top: pos.top, left: pos.left, width: RESCAN_CONFIRM_WIDTH }}
          className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 px-3 py-2.5"
        >
          <span className="typo-caption font-semibold text-foreground block mb-1">Rescan all projects?</span>
          <p className="typo-caption text-foreground/60 leading-snug mb-2.5" style={{ fontWeight: 400 }}>
            Re-runs the cross-project metadata scan over every registered project and re-derives each readiness
            passport — stack, coverage and scores. Read-only: nothing in your repos is modified.
          </p>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setAnchor(null)}
              className="px-2.5 py-1 rounded-interactive typo-caption font-medium text-foreground hover:bg-secondary/40 border border-primary/10 transition-colors"
            >
              No
            </button>
            <button
              type="button"
              onClick={() => { setAnchor(null); onConfirm(); }}
              className="px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors"
            >
              Yes, rescan
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
