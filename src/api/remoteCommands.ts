import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { RemoteCommand } from '@/lib/bindings/RemoteCommand';

/** Pending run-requests from the web dashboard targeted at this device. */
export const listPendingRemoteCommands = () =>
  invokeWithTimeout<RemoteCommand[]>('remote_command_list_pending');

/** Approve a request: runs the persona locally and returns the execution id. */
export const approveRemoteCommand = (id: string) =>
  invokeWithTimeout<string>('remote_command_approve', { id });

/** Reject a request. */
export const rejectRemoteCommand = (id: string) =>
  invokeWithTimeout<void>('remote_command_reject', { id });
