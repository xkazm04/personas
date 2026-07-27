// Extraction controls for a workspace's library (Arc 2). Two paths:
//  • Mine  — deterministic, no-LLM cross-project miners; instant, dedup-gated.
//  • Harvest — dispatch Fleet sessions that read the repo and propose
//    practices; Import pulls the finished runs into the library.
//
// Harvest fans OUT PER SCOPE (see workspace_scopes.rs). One session per repo
// could satisfy its brief by reading the root configs — measured: 14 items,
// none from feature code — so a repo is split into named territories and each
// wave dispatches the least-recently-harvested ones. Coverage state makes
// successive waves ADVANCE instead of re-reading the cheapest ground.
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Pickaxe, Play, DownloadCloud, ChevronDown, GitCompare, Loader2, ShieldCheck } from 'lucide-react';

import { listSessions, renameSession, spawnSession } from '@/api/fleet/fleet';
import {
  getDivergenceStatus,
  ingestWorkspaceHarvest,
  listHarvestCoverage,
  prepareWorkspaceHarvest,
  runWorkspaceDivergence,
  runWorkspaceMiners,
  getVerifyStatus,
  verifyWorkspaceAdoptions,
} from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import type { WorkspaceHarvestCoverage } from '@/lib/bindings/WorkspaceHarvestCoverage';

import { coverageRatio, selectHarvestWave } from './harvestWave';
import { buildHarvestPrompt, harvestDispatchKey } from './practiceHarvestPrompt';
import { useHarvestAutoIngest } from './useHarvestAutoIngest';
import type { Workspace } from './workspaceStore';

/** "3/13 scopes harvested" — the number that makes an unread codebase visible.
 *  Renders nothing until coverage has loaded, rather than flashing a 0/0 that
 *  would read as "nothing to harvest". */
function ScopeCoverage({
  rows,
  label,
  tx,
}: {
  rows: WorkspaceHarvestCoverage[] | undefined;
  label: string;
  tx: (template: string, vars: Record<string, string | number>) => string;
}) {
  const ratio = coverageRatio(rows);
  if (!ratio) return null;
  return (
    <span
      className={`typo-caption block ${ratio.done === ratio.total ? 'text-muted-foreground' : 'text-status-warning'}`}
    >
      {tx(label, ratio)}
    </span>
  );
}

export function ExtractionMenu({
  workspace,
  memberProjects,
  onChanged,
}: {
  workspace: Workspace;
  memberProjects: DevProject[];
  onChanged: () => void;
}) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Divergence runs as an in-app background job — poll until it settles, then
  // report and refresh. The job id is the only state worth holding.
  const [divergenceJob, setDivergenceJob] = useState<string | null>(null);
  const [divergenceLine, setDivergenceLine] = useState<string | null>(null);
  const settled = useRef(false);
  // Per-project scope coverage, loaded when the menu opens. Read-only signal:
  // it exists so a half-read repo cannot look finished.
  const [coverage, setCoverage] = useState<Record<string, WorkspaceHarvestCoverage[]>>({});

  // Close the agent loop: a harvest that finishes in Fleet ingests itself.
  // Manual Import stays as the fallback for runs finished while this surface
  // was closed (the poll only runs while mounted).
  const { markLive } = useHarvestAutoIngest({
    workspaceId: workspace.id,
    memberProjects,
    onIngested: onChanged,
  });

  // Coverage is only interesting while the menu is open, and it changes on
  // ingest — reload on every open rather than holding a subscription.
  useEffect(() => {
    if (!open) return;
    let live = true;
    // One unreadable repo must not blank the whole menu's coverage, but the
    // failure still deserves a breadcrumb — hence try/catch + silentCatch
    // rather than a bare inline .catch().
    const load = async (id: string): Promise<readonly [string, WorkspaceHarvestCoverage[]]> => {
      try {
        return [id, await listHarvestCoverage(id)] as const;
      } catch (err) {
        silentCatch('workspaces:harvestCoverage')(err);
        return [id, []] as const;
      }
    };
    void Promise.all(memberProjects.map((p) => load(p.id)))
      .then((pairs) => {
        if (live) setCoverage(Object.fromEntries(pairs));
      })
      .catch(silentCatch('workspaces:harvestCoverage'));
    return () => {
      live = false;
    };
  }, [open, memberProjects]);

  useEffect(() => {
    if (!divergenceJob) return;
    settled.current = false;
    const timer = setInterval(() => {
      void getDivergenceStatus(divergenceJob)
        .then((s) => {
          const last = s.lines?.[s.lines.length - 1];
          if (last) setDivergenceLine(last);
          if (settled.current) return;
          if (s.status === 'completed') {
            settled.current = true;
            addToast(
              tx(tw.divergence_result, { proposed: s.proposed ?? 0, inserted: s.inserted ?? 0 }),
              (s.inserted ?? 0) > 0 ? 'success' : 'warning',
            );
            setDivergenceJob(null);
            setDivergenceLine(null);
            onChanged();
          } else if (s.status === 'failed' || s.status === 'not_found') {
            settled.current = true;
            addToast(s.error || tw.divergence_failed, 'error');
            setDivergenceJob(null);
            setDivergenceLine(null);
          }
        })
        .catch(silentCatch('workspaces:divergencePoll'));
    }, 2500);
    return () => clearInterval(timer);
  }, [divergenceJob, addToast, tx, tw, onChanged]);

  const wsShim: DevWorkspace = {
    id: workspace.id,
    name: workspace.name,
    color: workspace.color,
    description: null,
    created_at: '',
    updated_at: '',
  };

  const runMiners = async () => {
    setBusy('miners');
    try {
      const summary = await runWorkspaceMiners(workspace.id);
      addToast(
        tx(tw.mine_result, { inserted: summary.inserted, skipped: summary.skipped.length }),
        summary.inserted > 0 ? 'success' : 'warning',
      );
      onChanged();
    } catch (err) {
      toastCatch('workspaces:runMiners')(err);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const findDivergences = async () => {
    setBusy('divergence');
    try {
      const jobId = await runWorkspaceDivergence(workspace.id);
      setDivergenceJob(jobId);
      addToast(tw.divergence_started, 'success');
    } catch (err) {
      toastCatch('workspaces:divergence')(err);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  /** Verify a project's adopted practices still hold. A failed verdict marks
   *  that project's cell `diverged` — never un-adopts. */
  const verify = async (project: DevProject) => {
    setBusy(`verify:${project.id}`);
    try {
      const jobId = await verifyWorkspaceAdoptions(workspace.id, project.id);
      addToast(tx(tw.verify_started, { project: project.name }), 'success');
      const timer = setInterval(() => {
        void getVerifyStatus(jobId)
          .then((s) => {
            if (s.status === 'completed') {
              clearInterval(timer);
              addToast(
                tx(tw.verify_result, {
                  project: project.name,
                  checked: s.checked ?? 0,
                  diverged: s.diverged ?? 0,
                }),
                (s.diverged ?? 0) > 0 ? 'warning' : 'success',
              );
              onChanged();
            } else if (s.status === 'failed' || s.status === 'not_found') {
              clearInterval(timer);
              if (s.error) addToast(s.error, 'error');
            }
          })
          .catch(silentCatch('workspaces:verifyPoll'));
      }, 3000);
    } catch (err) {
      toastCatch('workspaces:verify')(err);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const harvest = async (project: DevProject) => {
    setBusy(`harvest:${project.id}`);
    try {
      // prepare() derives the territories AND reconciles the coverage ledger,
      // so it must run before we read coverage to pick a wave.
      const prep = await prepareWorkspaceHarvest(workspace.id, project.id);
      const coverage = await listHarvestCoverage(project.id);
      if (coverage.length === 0) {
        addToast(tx(tw.harvest_no_scopes, { project: project.name }), 'warning');
        return;
      }

      // Already-running territories are skipped rather than re-dispatched;
      // the rest are already ordered never-harvested-first by the backend.
      const snap = await listSessions();
      const running = new Set(
        snap.sessions.filter((s) => s.state !== 'exited').map((s) => s.name),
      );
      const { wave, remaining } = selectHarvestWave(coverage, (scopeId) =>
        running.has(harvestDispatchKey(workspace.id, project.id, scopeId)),
      );
      if (wave.length === 0) {
        addToast(tx(tw.harvest_already, { project: project.name }), 'warning');
        return;
      }

      for (const scope of wave) {
        const key = harvestDispatchKey(workspace.id, project.id, scope.scope_id);
        const sessionId = await spawnSession(prep.root_path, [
          buildHarvestPrompt(wsShim, project, {
            id: scope.scope_id,
            label: scope.scope_label,
            fileCount: Number(scope.file_count),
          }),
        ]);
        await renameSession(sessionId, key);
      }
      // Arm the auto-ingest watcher immediately, so a session that finishes
      // between polls still produces an active→settled transition.
      markLive(project.id);
      // Say what is left, not just what started: a wave that covers 4 of 13
      // territories must not read as "the repo has been harvested".
      addToast(
        tx(tw.harvest_wave_dispatched, {
          project: project.name,
          count: wave.length,
          remaining,
        }),
        'success',
      );
    } catch (err) {
      toastCatch('workspaces:harvest')(err);
    } finally {
      setBusy(null);
    }
  };

  const importHarvest = async (project: DevProject) => {
    setBusy(`import:${project.id}`);
    try {
      const summary = await ingestWorkspaceHarvest(workspace.id, project.id);
      addToast(
        tx(tw.harvest_imported, {
          project: project.name,
          inserted: summary.inserted,
          skipped: summary.skipped.length,
        }),
        summary.inserted > 0 ? 'success' : 'warning',
      );
      onChanged();
    } catch (err) {
      toastCatch('workspaces:importHarvest')(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      {divergenceLine && (
        <span
          className="absolute right-0 -top-5 typo-caption text-muted-foreground truncate max-w-72"
          title={divergenceLine}
        >
          {divergenceLine}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="typo-label flex items-center gap-1.5 rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/15 transition-colors"
      >
        {divergenceJob ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        {divergenceJob ? tw.divergence_running : tw.extract}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-card border border-primary/15 bg-background shadow-elevation-3 p-2">
            <button
              type="button"
              onClick={runMiners}
              disabled={busy === 'miners'}
              className="w-full flex items-start gap-2.5 rounded-interactive px-2.5 py-2 text-left hover:bg-secondary/40 transition-colors disabled:opacity-50"
            >
              <Pickaxe className="w-4 h-4 mt-0.5 text-primary shrink-0" />
              <span className="min-w-0">
                <span className="typo-body text-foreground block">{tw.mine}</span>
                <span className="typo-caption text-muted-foreground block">{tw.mine_hint}</span>
              </span>
            </button>

            <button
              type="button"
              onClick={findDivergences}
              disabled={busy === 'divergence' || divergenceJob !== null}
              className="w-full flex items-start gap-2.5 rounded-interactive px-2.5 py-2 text-left hover:bg-secondary/40 transition-colors disabled:opacity-50"
            >
              <GitCompare className="w-4 h-4 mt-0.5 text-primary shrink-0" />
              <span className="min-w-0">
                <span className="typo-body text-foreground block">{tw.divergence}</span>
                <span className="typo-caption text-muted-foreground block">{tw.divergence_hint}</span>
              </span>
            </button>

            <div className="typo-label text-muted-foreground uppercase tracking-wide px-2.5 pt-3 pb-1">
              {tw.harvest_section}
            </div>
            {memberProjects.length === 0 && (
              <p className="typo-caption text-muted-foreground px-2.5 pb-2">{tw.harvest_no_members}</p>
            )}
            {memberProjects.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-interactive px-2.5 py-1.5 hover:bg-secondary/30 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="typo-body text-foreground truncate block">{p.name}</span>
                  <ScopeCoverage rows={coverage[p.id]} label={tw.harvest_coverage} tx={tx} />
                </span>
                <button
                  type="button"
                  aria-label={tx(tw.harvest_action, { project: p.name })}
                  onClick={() => harvest(p)}
                  disabled={busy === `harvest:${p.id}`}
                  className="rounded-interactive p-1 text-foreground/80 hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={tx(tw.harvest_import_action, { project: p.name })}
                  onClick={() => importHarvest(p)}
                  disabled={busy === `import:${p.id}`}
                  className="rounded-interactive p-1 text-foreground/80 hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={tx(tw.verify_action, { project: p.name })}
                  onClick={() => verify(p)}
                  disabled={busy === `verify:${p.id}`}
                  className="rounded-interactive p-1 text-foreground/80 hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
