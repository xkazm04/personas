// Roll one adopted practice out to member repos (Arc 3 push distribution).
// Per project: its current adoption state, and a dispatch that sends a Fleet
// Dev-runner session into that repo with the practice + evidence + a
// customize-for-this-codebase instruction. Dispatching flips the matrix cell
// to `dispatched`; the session's own verdict (ADOPTED / DECLINED) is what the
// human reads before marking it adopted.
import { useEffect, useState } from 'react';
import { Play, Check, X, CircleDot, Ban } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { listSessions, renameSession, spawnSession } from '@/api/fleet/fleet';
import {
  listWorkspaceAdoption,
  setWorkspaceAdoption,
  type AdoptionState,
} from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { adoptDispatchKey, buildAdoptPrompt } from './adoptPracticePrompt';

const STATE_ICON: Record<string, typeof Play> = {
  adopted: Check,
  dispatched: CircleDot,
  diverged: X,
  na: Ban,
};

export function PracticeRolloutModal({
  practice,
  workspaceName,
  workspaceId,
  memberProjects,
  onClose,
  onChanged,
}: {
  practice: WorkspaceKnowledge;
  workspaceName: string;
  workspaceId: string;
  memberProjects: DevProject[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const addToast = useToastStore((s) => s.addToast);
  const [states, setStates] = useState<Record<string, AdoptionState>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void listWorkspaceAdoption(workspaceId)
      .then((rows) => {
        const mine: Record<string, AdoptionState> = {};
        for (const r of rows) {
          if (r.practice_id === practice.id) mine[r.project_id] = r.state as AdoptionState;
        }
        setStates(mine);
      })
      .catch(silentCatch('workspaces:rolloutStates'));
  }, [workspaceId, practice.id]);

  const dispatch = async (project: DevProject) => {
    setBusy(project.id);
    try {
      const key = adoptDispatchKey(practice.id, project.id);
      const snap = await listSessions();
      if (snap.sessions.find((s) => s.name === key && s.state !== 'exited')) {
        addToast(tx(tw.rollout_already, { project: project.name }), 'warning');
        return;
      }
      const sessionId = await spawnSession(project.root_path, [
        buildAdoptPrompt(practice, project, workspaceName),
      ]);
      await renameSession(sessionId, key);
      await setWorkspaceAdoption(practice.id, project.id, 'dispatched', undefined, key);
      setStates((s) => ({ ...s, [project.id]: 'dispatched' }));
      addToast(tx(tw.rollout_dispatched, { project: project.name }), 'success');
      onChanged();
    } catch (err) {
      toastCatch('workspaces:rolloutDispatch')(err);
    } finally {
      setBusy(null);
    }
  };

  const mark = async (project: DevProject, state: AdoptionState) => {
    setBusy(project.id);
    try {
      await setWorkspaceAdoption(practice.id, project.id, state);
      setStates((s) => ({ ...s, [project.id]: state }));
      onChanged();
    } catch (err) {
      toastCatch('workspaces:rolloutMark')(err);
    } finally {
      setBusy(null);
    }
  };

  const stateLabel: Record<string, string> = {
    adopted: tw.state_adopted,
    dispatched: tw.state_dispatched,
    diverged: tw.state_diverged,
    proposed: tw.state_proposed,
    na: tw.state_na,
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="practice-rollout" size="md" staggerChildren={false}>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <h2 id="practice-rollout" className="typo-title text-foreground">
            {tw.rollout_title}
          </h2>
          <p className="typo-body text-muted-foreground mt-1">{practice.title}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          {memberProjects.length === 0 && (
            <p className="typo-body text-muted-foreground">{tw.harvest_no_members}</p>
          )}
          {memberProjects.map((p) => {
            const state = states[p.id] ?? 'proposed';
            const Icon = STATE_ICON[state];
            const isNa = state === 'na';
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-interactive border border-primary/10 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="typo-body text-foreground block truncate">{p.name}</span>
                  <span className="typo-caption text-muted-foreground flex items-center gap-1">
                    {Icon && <Icon className="w-3 h-3" />}
                    {stateLabel[state] ?? state}
                  </span>
                </span>
                {!isNa && state !== 'adopted' && (
                  <button
                    type="button"
                    onClick={() => dispatch(p)}
                    disabled={busy === p.id}
                    aria-label={tx(tw.rollout_action, { project: p.name })}
                    className="typo-label flex items-center gap-1 rounded-interactive border border-primary/20 bg-primary/10 px-2 py-1 text-foreground hover:bg-primary/15 disabled:opacity-40 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    {tw.rollout_dispatch}
                  </button>
                )}
                {state !== 'adopted' && !isNa && (
                  <button
                    type="button"
                    onClick={() => mark(p, 'adopted')}
                    disabled={busy === p.id}
                    aria-label={tx(tw.rollout_mark_adopted, { project: p.name })}
                    className="rounded-interactive p-1.5 text-status-success hover:bg-status-success/10 disabled:opacity-40 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
                {state === 'adopted' && (
                  <button
                    type="button"
                    onClick={() => mark(p, 'diverged')}
                    disabled={busy === p.id}
                    aria-label={tx(tw.rollout_mark_diverged, { project: p.name })}
                    className="typo-label rounded-interactive border border-primary/10 px-2 py-1 text-foreground/70 hover:bg-secondary/40 disabled:opacity-40 transition-colors"
                  >
                    {tw.state_diverged}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t.common.close}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
