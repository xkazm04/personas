/**
 * Cross-device instruction dispatch IPC.
 *
 * Backing Rust: `src-tauri/src/commands/network/remote_jobs.rs`. The two reads
 * are plain DB reads and work with the network stopped (yesterday's history has
 * to be readable without the link being up); the send needs a live, paired,
 * reachable peer and fails typed when it is not.
 *
 * Like every other p2p surface, callers must clear `probeP2pSupport()` first —
 * see `@/lib/network/p2pCapability`. The store slice does that for the app; use
 * these directly only from code that has already probed.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { RemoteJobDirection } from '@/lib/bindings/RemoteJobDirection';
import type { RemoteJobNote } from '@/lib/bindings/RemoteJobNote';
import type { RemoteJobStatus } from '@/lib/bindings/RemoteJobStatus';

export type { RemoteJob, RemoteJobDirection, RemoteJobNote, RemoteJobStatus };

/**
 * The remote-job history, newest first. Omit `direction` for the merged
 * timeline; the backend treats `undefined` and `"all"` identically.
 */
export const listRemoteJobs = (direction?: RemoteJobDirection | 'all', limit?: number) =>
  invoke<RemoteJob[]>('list_remote_jobs', { direction, limit });

/** One job's progress notes, oldest first — the transcript under a job row. */
export const listRemoteJobNotes = (jobId: string) =>
  invoke<RemoteJobNote[]>('list_remote_job_notes', { jobId });

/**
 * Ask a paired device to run a natural-language instruction. Resolves once the
 * peer has acknowledged, so the returned row already says `running` (or carries
 * the refusal reason) without a second round trip.
 *
 * The wait is one LAN round trip, not the length of the turn — but it is a
 * round trip to a machine that may be mid-suspend, so it gets a longer leash
 * than the default before we call it a timeout.
 */
export const sendRemoteInstruction = (peerId: string, instruction: string, kind?: string) =>
  invoke<RemoteJob>('send_remote_instruction', { peerId, instruction, kind }, {
    timeoutMs: SEND_INSTRUCTION_TIMEOUT_MS,
  });

/** Ceiling on the peer's acknowledgement of a dispatched instruction. */
export const SEND_INSTRUCTION_TIMEOUT_MS = 45_000;
