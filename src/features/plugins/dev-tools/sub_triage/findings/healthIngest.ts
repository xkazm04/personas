// Health ingest — the scheduled entry point to the findings loop
// (docs/plans/dev-findings-loop.md §7 / the `health_ingest` system op).
//
// The Rust op can't run the sweep itself: the emitters, the telemetry adapters, the
// verdict engine and the passport derive are all TypeScript. Rather than maintain a
// second Rust implementation of the same thresholds (which could silently diverge —
// exactly the bug class this feature exists to catch), the op emits an event and this
// module runs the sweep the app already has.
//
// Unlike SweepButton this runs HEADLESS — no hooks, no component. It gathers its own
// inputs through the APIs, so a cron tick can drive it with no UI mounted.
import {
  getCrossProjectMetadata,
  listIdeas,
  listProjects,
  listTasks,
} from '@/api/devTools/devTools';
import { derivePassportFromMetadata } from '@/features/teams/sub_factory/passport/passportDerive';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';

import { runFindingSweep } from './sweep';
import type { SweepResult } from './types';

/** Build the human-readable line the toast (and the op's log) carry. */
export function describeSweep(res: SweepResult): string {
  const parts = [`${res.created} raised`];
  if (res.duplicates > 0) parts.push(`${res.duplicates} already known`);
  if (res.dropped > 0) parts.push(`${res.dropped} over the cap`);

  const v = res.verified;
  const verdicts: string[] = [];
  if (v.cleared) verdicts.push(`${v.cleared} cleared`);
  if (v.moved) verdicts.push(`${v.moved} moved`);
  if (v.unchanged) verdicts.push(`${v.unchanged} unchanged`);
  if (v.regressed) verdicts.push(`${v.regressed} REGRESSED`);
  if (verdicts.length > 0) parts.push(`verified: ${verdicts.join(', ')}`);

  // Never let a thin sweep read as a clean bill of health.
  if (res.skippedSensors.length > 0) parts.push(`skipped: ${res.skippedSensors.join(', ')}`);
  return parts.join(' · ');
}

/**
 * Run a full sweep + verification pass for one project, headlessly.
 * Returns null when the project is gone (an automation can outlive its project).
 */
export async function runHealthIngest(projectId: string): Promise<SweepResult | null> {
  const projects = await listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;

  // Passport (enables the standards + passport-gap emitters). Absent scan → the
  // sweep skips those sensors and SAYS so; it does not fail.
  let passport;
  try {
    const meta = await getCrossProjectMetadata();
    const projectMeta = meta?.projects?.find((m) => m.project_id === projectId);
    if (projectMeta) passport = derivePassportFromMetadata(projectMeta, project);
  } catch (e) {
    silentCatch('healthIngest:passport')(e);
  }

  const [ideas, tasks] = await Promise.all([
    listIdeas(projectId).catch(() => []),
    listTasks(projectId).catch(() => []),
  ]);

  const credentials = useVaultStore.getState().credentials;

  const res = await runFindingSweep({
    project,
    credentials,
    passport,
    ideas,
    tasks,
  });

  // Refresh the store so an open Triage tab shows the new findings + verdicts.
  const sys = useSystemStore.getState();
  if (sys.activeProjectId === projectId) {
    await sys.fetchIdeas(projectId).catch(silentCatch('healthIngest:fetchIdeas'));
  }

  return res;
}

/**
 * The event handler: a scheduled (or manually run) `health_ingest` op fired.
 * Toasts the outcome — a regression never wears a success colour.
 */
export async function handleHealthIngestRequested(projectId: string): Promise<void> {
  const addToast = useToastStore.getState().addToast;
  try {
    const res = await runHealthIngest(projectId);
    if (!res) return; // project no longer exists — nothing to say
    const tone =
      res.verified.regressed > 0
        ? 'error'
        : res.created > 0 || res.verified.cleared + res.verified.moved > 0
          ? 'success'
          : 'warning';
    addToast(`Health ingest — ${describeSweep(res)}`, tone);
  } catch (e) {
    silentCatch('healthIngest:run')(e);
  }
}
