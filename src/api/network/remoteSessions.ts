/**
 * Remote sessions IPC: dispatch a fleet session to another of the operator's
 * paired devices, and track and steer it from this one.
 *
 * Backing Rust: `src-tauri/src/commands/network/remote_sessions.rs`. The reads
 * are DB reads and work with the network stopped; a dispatch to an offline
 * device succeeds with a `queued` job that goes out on the next link-up.
 *
 * Like every other p2p surface, callers must clear `probeP2pSupport()` first -
 * see `@/lib/network/p2pCapability`.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { DeviceReachability } from '@/lib/bindings/DeviceReachability';
import type { DispatchDevice } from '@/lib/bindings/DispatchDevice';
import type { FleetSessionJobPayload } from '@/lib/bindings/FleetSessionJobPayload';
import type { FleetSessionJobReceipt } from '@/lib/bindings/FleetSessionJobReceipt';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { RemoteSessionCommand } from '@/lib/bindings/RemoteSessionCommand';
import type { RemoteSessionMode } from '@/lib/bindings/RemoteSessionMode';
import type { RemoteSessionOutputChunk } from '@/lib/bindings/RemoteSessionOutputChunk';
import type { RemoteSessionState } from '@/lib/bindings/RemoteSessionState';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';

export type {
  DeviceReachability,
  DispatchDevice,
  FleetSessionJobPayload,
  FleetSessionJobReceipt,
  RemoteSessionCommand,
  RemoteSessionMode,
  RemoteSessionOutputChunk,
  RemoteSessionState,
  RemoteSessionView,
};

/** Ceiling on the peer's acknowledgement of a dispatch or a steering command. */
export const REMOTE_SESSION_ACK_TIMEOUT_MS = 45_000;

/**
 * Send one fleet session to a paired device. The returned job is `pending` or
 * `running` when the peer answered, `queued` when it is offline, or `refused`
 * with the peer's reason.
 */
export const dispatchRemoteFleetSession = (peerId: string, payload: FleetSessionJobPayload) =>
  invoke<RemoteJob>('dispatch_remote_fleet_session', { peerId, payload }, {
    timeoutMs: REMOTE_SESSION_ACK_TIMEOUT_MS,
  });

/** The remote sessions this device dispatched (live, or finished within an hour). */
export const listRemoteSessions = () => invoke<RemoteSessionView[]>('list_remote_sessions');

/** Steer a running remote session. `text` is required for `send_input` only. */
export const remoteSessionCommand = (
  jobId: string,
  command: RemoteSessionCommand,
  text: string | null = null,
) =>
  invoke<void>('remote_session_command', { jobId, command, text }, {
    timeoutMs: REMOTE_SESSION_ACK_TIMEOUT_MS,
  });

/** Start or stop the lossy terminal tail. Unsubscribing never cancels the session. */
export const remoteSessionSubscribeOutput = (jobId: string, subscribe: boolean) =>
  invoke<void>('remote_session_subscribe_output', { jobId, subscribe });

/** Paired devices as dispatch targets, excluding this one. */
export const listDispatchDevices = () => invoke<DispatchDevice[]>('list_dispatch_devices');
