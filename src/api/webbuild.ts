import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { DevServerStatus } from '@/lib/bindings/DevServerStatus';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { BuildTurnResult } from '@/lib/bindings/BuildTurnResult';
import type { BuildVersion } from '@/lib/bindings/BuildVersion';

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

/** Interrupt the in-flight build turn for a project (the Studio Stop button). */
export const webbuildSessionStop = (projectId: string) =>
  invokeWithTimeout<boolean>('webbuild_session_stop', { projectId });

/** Live status of a project's dev server, or null when not running. */
export const webbuildStatus = (projectId: string) =>
  invokeWithTimeout<DevServerStatus | null>('webbuild_status', { projectId });

/** Status of every running dev server. */
export const webbuildListServers = () =>
  invokeWithTimeout<DevServerStatus[]>('webbuild_list_servers');

/** Registered Dev Tools projects — reused for the Studio project picker. */
export const webbuildListProjects = () =>
  invokeWithTimeout<DevProject[]>('dev_tools_list_projects', { status: undefined });

/** Of the given projects, the ids that are Next.js apps Studio can build. */
export const webbuildNextReady = (projectIds: string[]) =>
  invokeWithTimeout<string[]>('webbuild_next_ready', { projectIds });

/** Register an existing project directory (an existing repo) as a Dev Tools
 *  project so it can be opened in Studio. Idempotent on the path. */
export const webbuildRegisterExisting = (name: string, path: string) =>
  invokeWithTimeout<DevProject>('webbuild_register_existing', { name, path });

/**
 * Send a build instruction to a project's build session — Athena edits the
 * project's code at its cwd; the dev server hot-reloads the preview. Returns
 * her short summary of what changed. Long-running (a coding turn), so a wide
 * timeout. Progress also streams on `companion://stream` keyed by
 * `webbuild:<projectId>`.
 */
/** C1 effort knob — maps to the CLI `--effort` for build turns. */
export type BuildEffort = 'low' | 'medium' | 'high' | 'xhigh';
/** C4 voice/style — injected into the build system prompt. */
export type BuildStyle = 'concise' | 'balanced' | 'teaching';

export const webbuildSessionSend = (
  projectId: string,
  message: string,
  effort?: BuildEffort,
  style?: BuildStyle,
  mcp?: string[],
) =>
  invokeWithTimeout<BuildTurnResult>(
    'webbuild_session_send',
    { projectId, message, effort, style, mcp },
    undefined,
    900_000,
  );

/** The generated project's app-router routes (for the preview route switcher). */
export const webbuildListRoutes = (projectId: string) =>
  invokeWithTimeout<string[]>('webbuild_list_routes', { projectId });

/** C7 — recent build-turn snapshots (version history), newest first. */
export const webbuildListVersions = (projectId: string) =>
  invokeWithTimeout<BuildVersion[]>('webbuild_list_versions', { projectId });

/** C7 — restore the project's files to a prior snapshot. */
export const webbuildRestoreVersion = (projectId: string, sha: string) =>
  invokeWithTimeout<void>('webbuild_restore_version', { projectId, sha });
