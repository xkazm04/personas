import type { UnlistenFn } from '@tauri-apps/api/event';

import type { DevServerView } from '@/lib/bindings/DevServerView';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { invokeWithTimeout } from '@/lib/tauriInvoke';

// Server control IPC (Browser > Server control, Fleet Monitor bay). The Rust
// side is `commands/infrastructure/dev_servers.rs`; every mutating command
// returns the row it touched AND announces the whole list on
// `dev-servers-changed`, so callers may ignore the return value.

/** A scan spawns a headless Claude CLI in the repo; Rust bounds it at 120 s. */
const SCAN_TIMEOUT_MS = 150_000;

/** Every dev project in the view (`dev_port` set), sorted by workspace then name. */
export const listDevServers = () => invokeWithTimeout<DevServerView[]>('dev_servers_list');

/** Start a project's dev server. Returns while it boots (`starting`). */
export const startDevServer = (projectId: string) =>
  invokeWithTimeout<DevServerView>('dev_server_start', { projectId });

/** Stop a project's dev server, ours or an external one holding its port (kills the tree). */
export const stopDevServer = (projectId: string) =>
  invokeWithTimeout<DevServerView>('dev_server_stop', { projectId });

export const restartDevServer = (projectId: string) =>
  invokeWithTimeout<DevServerView>('dev_server_restart', { projectId });

/** Set the command and port. Auto-whitelists `http://localhost:<port>` when missing. */
export const configureDevServer = (projectId: string, devCommand: string | null, devPort: number) =>
  invokeWithTimeout<DevServerView>('dev_server_configure', { projectId, devCommand, devPort });

/** Take a project out of the view. Refused while its server is live; never deletes the project. */
export const removeDevServer = (projectId: string) =>
  invokeWithTimeout<void>('dev_server_remove', { projectId });

/** Add a repo: get-or-create its dev project, assign a free port, start the AI scan. */
export const addDevServerApp = (rootPath: string, workspaceId: string | null) =>
  invokeWithTimeout<DevServerView>('dev_server_add_app', { rootPath, workspaceId }, undefined, SCAN_TIMEOUT_MS);

/** Re-run the AI scan for a project (command, port, tech stack). */
export const rescanDevServer = (projectId: string) =>
  invokeWithTimeout<DevServerView>('dev_server_rescan', { projectId }, undefined, SCAN_TIMEOUT_MS);

/** Follow the whole list. */
export function listenDevServers(handler: (servers: DevServerView[]) => void): Promise<UnlistenFn> {
  return typedListen(EventName.DEV_SERVERS_CHANGED, handler);
}
