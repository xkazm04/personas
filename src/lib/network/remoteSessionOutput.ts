/**
 * The remote terminal tail, from the event bridge to whichever drawer is open.
 *
 * `network:remote-session-output` is the one high-frequency event of the remote
 * lane, and it only matters to a drawer that subscribed the tail. It is kept
 * out of the store on purpose: a chunk is a write into one xterm, not state,
 * and routing it through Zustand would notify every store subscriber per
 * chunk. The event bridge publishes here; the drawer's mirror listens.
 *
 * The tail is LOSSY by design (a slow link must never back-pressure the remote
 * PTY). `seq` counts chunks per job, so {@link chunkGap} tells the viewer how
 * many it missed; nothing replays them.
 */
import type { RemoteSessionOutputChunk } from '@/lib/bindings/RemoteSessionOutputChunk';

type Listener = (chunk: RemoteSessionOutputChunk) => void;

const listeners = new Set<Listener>();

/** Called by the event bridge for every pushed chunk. */
export function publishRemoteSessionOutput(chunk: RemoteSessionOutputChunk): void {
  for (const l of listeners) l(chunk);
}

/** Listen to every job's chunks; filter by `jobId` in the listener. Returns the unsubscribe. */
export function onRemoteSessionOutput(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How many chunks were skipped between the last one written (`lastSeq`, or
 * `null` before the first) and `seq`. The first chunk a viewer sees is never a
 * gap: the tail starts wherever the subscription caught it.
 */
export function chunkGap(lastSeq: number | null, seq: number): number {
  if (lastSeq === null) return 0;
  return Math.max(0, seq - lastSeq - 1);
}

/** Decode a chunk's base64 payload to the raw bytes xterm writes. */
export function decodeChunk(chunkB64: string): Uint8Array {
  const bin = atob(chunkB64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
