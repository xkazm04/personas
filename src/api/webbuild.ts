import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { DevServerStatus } from '@/lib/bindings/DevServerStatus';
import type { DevProject } from '@/lib/bindings/DevProject';

// Web-build runtime IPC (Athena web-dev companion, P0/P1). Project rows reuse
// the Dev Tools registry; dev servers live in the Rust `webbuild` module.

/** Scaffold + register a blank Next/TS/Tailwind project. Slow — Bun install. */
export const webbuildScaffold = (name: string) =>
  invokeWithTimeout<DevProject>('webbuild_scaffold', { name }, undefined, 600_000);

/** Start (or restart) a project's Bun dev server. May still be booting. */
export const webbuildDevStart = (projectId: string) =>
  invokeWithTimeout<DevServerStatus>('webbuild_dev_start', { projectId });

/** Stop a project's dev server (kills the process tree). Idempotent. */
export const webbuildDevStop = (projectId: string) =>
  invokeWithTimeout<void>('webbuild_dev_stop', { projectId });

/** Live status of a project's dev server, or null when not running. */
export const webbuildStatus = (projectId: string) =>
  invokeWithTimeout<DevServerStatus | null>('webbuild_status', { projectId });

/** Status of every running dev server. */
export const webbuildListServers = () =>
  invokeWithTimeout<DevServerStatus[]>('webbuild_list_servers');

/** Registered Dev Tools projects — reused for the Studio project picker. */
export const webbuildListProjects = () =>
  invokeWithTimeout<DevProject[]>('dev_tools_list_projects', { status: undefined });

/**
 * Send a build instruction to a project's build session — Athena edits the
 * project's code at its cwd; the dev server hot-reloads the preview. Returns
 * her short summary of what changed. Long-running (a coding turn), so a wide
 * timeout. Progress also streams on `companion://stream` keyed by
 * `webbuild:<projectId>`.
 */
export const webbuildSessionSend = (projectId: string, message: string) =>
  invokeWithTimeout<string>('webbuild_session_send', { projectId, message }, undefined, 900_000);
