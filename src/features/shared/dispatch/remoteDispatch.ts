// remoteDispatch — sending a prepared dispatch to a paired device instead of
// running it here. Shared by every door that mounts `RunOnSelect`.
//
// Only two of the four transports can cross (design decision D6): `fleet`
// becomes an INTERACTIVE session and `cli` a HEADLESS one on the other machine.
// `dev_runner` is this device's own task runner, and `console` is a window the
// operator owns on THIS desktop - neither exists over there.
//
// `branch: ''` IS DELIBERATE. The Rust command mints the branch
// (`remote/<originPeerShort8>/<jobShort8>`) so it is unique per job; a branch
// named on this side could collide.

import { useEffect } from 'react';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { RemoteSessionMode } from '@/lib/bindings/RemoteSessionMode';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { DispatchMethod } from './DispatchChooser';

/** The transports a remote device can run. */
export const REMOTE_METHODS: readonly DispatchMethod[] = ['fleet', 'cli'];

export function isRemoteCapable(method: DispatchMethod): boolean {
  return REMOTE_METHODS.includes(method);
}

/** `fleet` is watched and steered (interactive); `cli` runs headless. */
export function remoteModeFor(method: DispatchMethod): RemoteSessionMode {
  return method === 'fleet' ? 'interactive' : 'headless';
}

/**
 * The peer answered no. The message IS the peer's reason token (for example
 * `project_not_found`), so `toastCatch` -> the error registry turns it into
 * product copy, and an unknown reason still reaches the operator verbatim.
 */
export class RemoteDispatchRefusedError extends Error {
  constructor(reason: string | null) {
    super(reason?.trim() || 'remote_dispatch_failed');
    this.name = 'RemoteDispatchRefusedError';
  }
}

export interface RemoteDispatchInput {
  peerId: string;
  projectId: string;
  projectName: string;
  githubUrl: string;
  prompt: string;
  mode: RemoteSessionMode;
}

/**
 * Send one fleet session to a paired device. Resolves with the job (queued or
 * accepted); throws `RemoteDispatchRefusedError` when the peer refused.
 */
export async function dispatchToDevice(input: RemoteDispatchInput): Promise<RemoteJob> {
  const job = await useSystemStore.getState().dispatchRemoteSession(input.peerId, {
    projectId: input.projectId,
    githubUrl: input.githubUrl,
    projectName: input.projectName,
    prompt: input.prompt,
    mode: input.mode,
    branch: '',
    personaId: null,
  });
  if (job.status === 'refused') throw new RemoteDispatchRefusedError(job.refusalReason);
  return job;
}

/**
 * The git remote of a dev project, looked up by id in the dev-tools store.
 * `DispatchRequest.target` carries only id, name and path, so the chooser asks
 * here. A cold store is filled once; `null` until then, and for a project with
 * no remote (every remote device is then disabled).
 */
export function useProjectGitRemote(projectId: string | null): string | null {
  const url = useSystemStore((s) => (projectId ? s.projects.find((p) => p.id === projectId)?.github_url ?? null : null));
  const cold = useSystemStore((s) => s.projects.length === 0);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  useEffect(() => {
    if (!projectId || !cold) return;
    void fetchProjects?.().catch(silentCatch('dispatch:fetchProjects'));
  }, [projectId, cold, fetchProjects]);
  return url?.trim() ? url : null;
}
