// Extraction controls for a workspace's library (Arc 2). Two paths:
//  • Mine  — deterministic, no-LLM cross-project miners; instant, dedup-gated.
//  • Harvest — dispatch a Fleet session per member repo that reads the repo and
//    proposes practices; Import pulls the finished run into the library.
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Pickaxe, Play, DownloadCloud, ChevronDown, GitCompare, Loader2 } from 'lucide-react';

import { listSessions, renameSession, spawnSession } from '@/api/fleet/fleet';
import {
  getDivergenceStatus,
  ingestWorkspaceHarvest,
  prepareWorkspaceHarvest,
  runWorkspaceDivergence,
  runWorkspaceMiners,
} from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { buildHarvestPrompt, harvestDispatchKey } from './practiceHarvestPrompt';
import type { Workspace } from './workspaceStore';

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

  const harvest = async (project: DevProject) => {
    setBusy(`harvest:${project.id}`);
    try {
      const key = harvestDispatchKey(workspace.id, project.id);
      const snap = await listSessions();
      if (snap.sessions.find((s) => s.name === key && s.state !== 'exited')) {
        addToast(tx(tw.harvest_already, { project: project.name }), 'warning');
        return;
      }
      const prep = await prepareWorkspaceHarvest(workspace.id, project.id);
      const sessionId = await spawnSession(prep.root_path, [buildHarvestPrompt(wsShim, project)]);
      await renameSession(sessionId, key);
      addToast(tx(tw.harvest_dispatched, { project: project.name }), 'success');
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
                <span className="typo-body text-foreground truncate flex-1 min-w-0">{p.name}</span>
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
