// R9 — the wall's follow-up actions become REAL Fleet dispatches.
//
// Impact analysis (what wiring "Queue Claude task" / "Wire connector" through
// Fleet actually touches):
//   • Spawn lane: `fleet_spawn_session(cwd, [prompt])` — a positional arg is
//     the session's FIRST PROMPT, so the terminal opens already working the
//     task. No new backend surface needed.
//   • Identity/dedup: the session's user-facing `name` carries a stable
//     dispatch key (`cockpit:<row>:<project>`). One task = one live terminal:
//     before dispatching we scan `fleet_list_sessions` for a non-exited
//     session with the same key and refuse to double-spawn until that
//     terminal is killed (hibernated still counts as alive — it can resume).
//   • Fleet visibility: nothing extra — the registry emits
//     `fleet-registry-changed` on spawn, so the Fleet tab lists the terminal
//     (grouped by cwd's project label, named by the dispatch key).
//   • cwd: the bench's projects are MOCK — there is no repo to root the CLI
//     in. Dispatches land in the user's home dir and the preset prompt opens
//     with a "mechanism test — plan only, touch nothing" guard. In the real
//     product the cwd is the project's repo root and the guard drops away.
//   • Slots/limits: spawns route through the live-slot scheduler
//     (`free_slot_for_spawn`), same as any Fleet session; a missing `claude`
//     binary surfaces as a spawn error → toast.
import { homeDir } from '@tauri-apps/api/path';

import { listSessions, renameSession, spawnSession } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';

import type { ImproveKind } from './wallMock';

/** Stable per-task identity — the dedup key carried in the session name. */
export function dispatchKey(projectId: string, rowKey: string): string {
  return `cockpit:${rowKey}:${projectId}`;
}

/** The preset first prompt per action family. Explicitly plan-only while the
 *  bench runs on mock projects with no repo behind them. */
export function buildDispatchPrompt(args: {
  kind: ImproveKind;
  projectName: string;
  rowLabel: string;
  current?: string;
  next?: string;
}): string {
  const { kind, projectName, rowLabel, current, next } = args;
  const goal =
    kind === 'connector'
      ? `Wire the "${rowLabel}" connector for project "${projectName}" so its sensor lights the cockpit dimension.`
      : kind === 'config'
        ? `Write the config that raises "${rowLabel}" for project "${projectName}"${current && next ? ` from "${current}" to "${next}"` : ''}.`
        : `Raise "${rowLabel}" for project "${projectName}"${current && next ? ` from "${current}" to "${next}"` : ''}.`;
  return [
    '[Personas Cockpit dispatch — prototype]',
    goal,
    'IMPORTANT: this is a dispatch-mechanism test against a MOCK project with no repo attached.',
    'Do NOT run commands or modify any files. Reply with a short, concrete plan (steps, files, verification) for how you would execute this task, then wait for further instructions.',
  ].join(' ');
}

/** The live terminal already working this task, if any (dedup gate).
 *  `Exited` is the only state that frees the key — a hibernated session can
 *  be woken and counts as occupying it. */
export async function findRunningDispatch(key: string): Promise<FleetSession | null> {
  const snap = await listSessions();
  return snap.sessions.find((s) => s.name === key && s.state !== 'exited') ?? null;
}

/** Spawn the terminal (preset prompt as the first message) and stamp the
 *  dispatch key as its name so Fleet shows it and the dedup gate sees it. */
export async function dispatchToFleet(key: string, prompt: string): Promise<string> {
  const running = await findRunningDispatch(key);
  if (running) throw new Error(`already running: ${key} (kill the terminal in Fleet first)`);
  const cwd = await homeDir();
  const sessionId = await spawnSession(cwd, [prompt]);
  await renameSession(sessionId, key);
  return sessionId;
}
