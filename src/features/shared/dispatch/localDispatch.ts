// localDispatch — the four transports that run a dispatch on THIS machine.
//
// Moved verbatim out of `DispatchChooser` when the chooser gained a second
// destination (a paired device, `remoteDispatch.ts`); the chooser now only
// decides WHERE, and each module owns HOW.

import { createTask, executeTask } from '@/api/devTools/devTools';
import {
  listSessions,
  renameSession,
  spawnExternalConsole,
  spawnHeadlessSession,
  spawnSession,
} from '@/api/fleet/fleet';
import { getActiveTranslations } from '@/i18n/useTranslation';
import type { DispatchMethod, DispatchRequest } from './DispatchChooser';

/**
 * Run `request` here over `method`. Resolves with the task id (dev_runner),
 * the session id (fleet/cli) or the console's pid. `prepare` runs first and a
 * throw from it aborts the dispatch.
 */
export async function runLocalDispatch(
  method: DispatchMethod,
  request: DispatchRequest,
  prompt: string,
  fleetKey: string,
): Promise<string> {
  await request.prepare?.();
  if (method === 'dev_runner') {
    const task = await createTask(request.title, request.target.projectId, prompt);
    await executeTask(task.id);
    return task.id;
  }
  if (method === 'fleet') {
    const snap = await listSessions();
    const running = snap.sessions.find((s) => s.name === fleetKey && s.state !== 'exited');
    if (running) throw new Error(getActiveTranslations().common.dispatch_already_running);
    const ref = await spawnSession(request.target.rootPath, [prompt]);
    await renameSession(ref, fleetKey);
    return ref;
  }
  if (method === 'console') {
    // No dedup check: the app holds no handle on these windows, so it
    // cannot know whether an earlier one is still open. The operator can
    // see their own terminals.
    const pid = await spawnExternalConsole({
      cwd: request.target.rootPath,
      prompt,
      skipPermissions: request.consoleSkipPermissions,
    });
    return String(pid);
  }
  const ref = await spawnHeadlessSession(request.target.rootPath, prompt);
  await renameSession(ref, `${fleetKey}:cli`);
  return ref;
}
