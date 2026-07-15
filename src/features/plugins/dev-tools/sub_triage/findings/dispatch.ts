// Dispatch a finding — the C/D half of the findings loop
// (docs/plans/dev-findings-loop.md §4).
//
// Two targets, deliberately parallel:
//
//   • runner — the Dev Task Runner. Autonomous: it builds and opens a PR.
//              "Let the app do it."
//   • fleet  — a Claude Code session in the project's cwd, seeded with the finding as
//              its first prompt. Interactive: the human steers it.
//              "I want to control it."
//
// This is NOT a fork. It's the product decision, expressed as a route: you A/B the two
// by rewiring `signal.raised` to one op or the other in Chain Studio. Neither the engine
// nor this module has an opinion about which is right.
//
// SAFETY: dispatch acts on production signal, potentially unattended. It does NOT invent
// its own guard rails — the trigger's `unattended_mode` (auto / dry_run / approval) is
// the gate, and an `approval`-mode automation holds its fire in `pending_trigger_fires`
// for a human. That machinery predates this feature; re-implementing it here would be
// both duplicated and less trustworthy.
import { getIdea, listProjects, createTask, executeTask, updateIdea } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { DevIdea } from '@/lib/bindings/DevIdea';

export type DispatchTarget = 'runner' | 'fleet';

/**
 * The prompt a dispatched finding carries. The finding's `description` is already
 * written as an instruction (the emitters seed it that way), and the evidence is the
 * justification — an agent that can see the numbers can tell whether it actually fixed
 * the thing, instead of guessing.
 */
export function dispatchPrompt(idea: DevIdea): string {
  const lines = [idea.title];
  if (idea.description) lines.push('', idea.description);
  if (idea.evidence) {
    lines.push('', `Evidence this was raised on: ${idea.evidence}`);
    lines.push(
      'Treat those numbers as the bar: the fix has to move them, not merely look plausible.',
    );
  }
  return lines.join('\n');
}

/** Dispatch one finding. Returns a short human-readable outcome. */
export async function dispatchFinding(
  ideaId: string,
  target: DispatchTarget,
): Promise<string> {
  const idea = await getIdea(ideaId);
  if (!idea.project_id) throw new Error('Finding has no project');

  const prompt = dispatchPrompt(idea);

  // Dispatching IS a decision to do the work — reflect that, so the finding doesn't
  // sit in the triage deck pretending nobody has looked at it.
  if (idea.status === 'pending') {
    await updateIdea(ideaId, { status: 'accepted' }).catch(silentCatch('dispatch:accept'));
  }

  if (target === 'runner') {
    // sourceIdeaId keeps the finding↔task link that VERIFICATION depends on.
    const task = await createTask(idea.title, idea.project_id, prompt, idea.id);
    await executeTask(task.id);
    return 'queued for the Task Runner';
  }

  // fleet — open a session in the project's own working directory.
  const projects = await listProjects();
  const project = projects.find((p) => p.id === idea.project_id);
  if (!project?.root_path) throw new Error('Project has no root path for a Fleet session');

  // A task row is still created, so the finding↔task link (and therefore VERIFICATION)
  // works identically whichever executor ran it. Without this, a Fleet-dispatched
  // finding could never be judged — and the two arms of the A/B would not be comparable.
  const task = await createTask(idea.title, idea.project_id, prompt, idea.id).catch((e) => {
    silentCatch('dispatch:fleetTask')(e);
    return null;
  });

  await spawnSession(project.root_path, [prompt]);
  return task ? 'opened a Fleet session (task linked)' : 'opened a Fleet session';
}

/** Event handler: a `signal_dispatch_*` op fired. */
export async function handleSignalDispatchRequested(
  ideaId: string,
  target: DispatchTarget,
): Promise<void> {
  const addToast = useToastStore.getState().addToast;
  try {
    const detail = await dispatchFinding(ideaId, target);
    addToast(`Finding dispatched — ${detail}`, 'success');

    // Refresh so an open Triage/Runner tab reflects it immediately.
    const sys = useSystemStore.getState();
    if (sys.activeProjectId) {
      await sys.fetchIdeas(sys.activeProjectId).catch(silentCatch('dispatch:fetchIdeas'));
      await sys.fetchTasks(sys.activeProjectId).catch(silentCatch('dispatch:fetchTasks'));
    }
  } catch (e) {
    silentCatch('dispatch:run')(e);
    addToast(`Finding dispatch to ${target} failed`, 'error');
  }
}
