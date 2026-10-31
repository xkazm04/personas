/**
 * Device mesh IPC: every paired device's latest snapshot (load, agents,
 * queue), the closed verb set one device may run on another, moving a queued
 * fleet entry to another device, and the onboarding probe verdicts.
 *
 * Backing Rust: `src-tauri/src/commands/network/mesh.rs`. A snapshot older than
 * 45 s arrives as `liveness: 'unknown'`, never as live. A verb aimed at an
 * offline device returns a `queued` job that goes out on the next link-up.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { CliMail } from '@/lib/bindings/CliMail';
import type { DeviceAgent } from '@/lib/bindings/DeviceAgent';
import type { DeviceHostLoad } from '@/lib/bindings/DeviceHostLoad';
import type { DeviceQueueEntry } from '@/lib/bindings/DeviceQueueEntry';
import type { DeviceSnapshot } from '@/lib/bindings/DeviceSnapshot';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { MeshLiveness } from '@/lib/bindings/MeshLiveness';
import type { MeshProbeVerdict } from '@/lib/bindings/MeshProbeVerdict';
import type { MeshVerbPayload } from '@/lib/bindings/MeshVerbPayload';
import type { MeshVerbReceipt } from '@/lib/bindings/MeshVerbReceipt';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';

export type {
  CliMail,
  DeviceAgent,
  DeviceHostLoad,
  DeviceQueueEntry,
  DeviceSnapshot,
  MeshDeviceView,
  MeshLiveness,
  MeshProbeVerdict,
  MeshVerbPayload,
  MeshVerbReceipt,
};

/** Ceiling on the peer's acknowledgement of a verb or a queue move. */
export const MESH_ACK_TIMEOUT_MS = 45_000;

/** This device first (`isSelf`), then every paired device. */
export const meshDeviceSnapshots = () => invoke<MeshDeviceView[]>('mesh_device_snapshots');

/** Run one closed verb on a paired device; the outcome lands in `receiptJson`. */
export const meshSendVerb = (peerId: string, payload: MeshVerbPayload) =>
  invoke<RemoteJob>('mesh_send_verb', { peerId, payload }, { timeoutMs: MESH_ACK_TIMEOUT_MS });

/**
 * Move one queued local fleet entry to a paired device. The local entry is
 * cancelled only after the peer accepts; a refusal leaves it where it was.
 */
export const meshQueueMove = (sessionId: string, peerId: string) =>
  invoke<RemoteJob>('mesh_queue_move', { sessionId, peerId }, { timeoutMs: MESH_ACK_TIMEOUT_MS });

