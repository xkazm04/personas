/**
 * Device mesh: every device's latest snapshot (load, agents, queue), what each
 * live run on THIS device consumes, and the Monitor's device filter.
 *
 * Thin like its siblings. Views arrive whole: `network:device-snapshot` pushes
 * one `MeshDeviceView` (replaced by `peerId`), `fleet-resource-sample` pushes
 * the FULL live set (so the sample map is replaced, never merged - a run that
 * ended simply stops being in it). `refreshMeshDevices` / `refreshLiveSamples`
 * are the reconcile reads a surface runs once its listener is attached
 * (snapshot-plus-stream: attach first, then read). A read never clobbers a
 * newer push: a device keeps the view with the later `receivedAtMs`, and a
 * sample read is dropped when a push landed while it was in flight.
 *
 * LIVENESS IS ALSO DECIDED HERE. The backend reads a snapshot older than its
 * stale bound as `unknown`; a quiet event stream would leave a `live` view in
 * the store forever, so `meshLiveness` is recomputed from `receivedAtMs` on
 * every write and on `tickMeshLiveness`, which the device strip drives every
 * 5 s while it is mounted. The map is only rewritten when a device's answer
 * changes, so the board does not re-render on the tick.
 *
 * VERB OUTCOMES ARE ROW STATE, NOT TOASTS. A verb returns the persisted
 * `RemoteJob`; it is folded into `remoteJobs` (whose event keeps it current)
 * and its id is remembered under the row's key in `meshOutcomes`, so the row
 * that asked shows `queued until it wakes` or the peer's refusal inline. An
 * IPC failure is reported to Sentry (`silentCatch`) and shown on the row in the
 * error registry's words. Toasts render under portal modals; a row does not.
 *
 * `meshPinned` is the dev fixture's latch (`meshFixture.ts`): while it is set
 * the reconcile reads are skipped so a seeded strip survives them.
 */
import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';
import { meshDeviceSnapshots, meshQueueMove, meshSendVerb } from '@/api/network/mesh';
import { resourceLiveSamples } from '@/api/fleet/resources';
import type { LiveResourceSample } from '@/lib/bindings/LiveResourceSample';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { MeshLiveness } from '@/lib/bindings/MeshLiveness';
import type { MeshVerbPayload } from '@/lib/bindings/MeshVerbPayload';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

/**
 * A snapshot older than this reads `unknown`, never `live`. Mirrors
 * `SNAPSHOT_STALE_AFTER_MS` in src-tauri/core/src/models/device_mesh.rs so a
 * fetch and a clock tick agree; tethered by `__tests__/meshSliceParity.test.ts`,
 * which reads the Rust constant and fails when the two drift.
 */
export const MESH_SNAPSHOT_STALE_MS = 45_000;

/** `'all'`, or the `peerId` the board is scoped to (this device's included). */
export type MeshFilter = 'all' | string;

/** What a row shows about the last thing it asked another device to do. */
export type MeshOutcomeState = 'pending' | 'accepted' | 'queued' | 'refused';

export interface MeshOutcome {
  state: MeshOutcomeState;
  /** The peer's refusal reason, or the error registry's sentence. */
  reason: string | null;
  /** The job the verb became; `null` while pending or when the call failed. */
  jobId: string | null;
  /** The device the verb was sent to. */
  peerId: string;
}

const NO_DEVICES: MeshDeviceView[] = [];
const NO_SAMPLES: Record<string, LiveResourceSample> = {};

/** The row key of a peer agent's toggle. */
export const agentOutcomeKey = (peerId: string, personaId: string) => `agent:${peerId}:${personaId}`;
/** The row key of a peer's queue (one line under its ladder). */
export const queueOutcomeKey = (peerId: string) => `queue:${peerId}`;
/** The row key of a local queued entry being moved. */
export const moveOutcomeKey = (sessionId: string) => `move:${sessionId}`;

/** A device's believable state at `now`. This device is always live. */
export function effectiveLiveness(view: MeshDeviceView, now: number): MeshLiveness {
  if (view.isSelf) return 'live';
  if (view.liveness !== 'live' || view.receivedAtMs === null) return 'unknown';
  return now - view.receivedAtMs > MESH_SNAPSHOT_STALE_MS ? 'unknown' : 'live';
}

function livenessOf(views: readonly MeshDeviceView[], now: number): Record<string, MeshLiveness> {
  const out: Record<string, MeshLiveness> = {};
  for (const v of views) out[v.peerId] = effectiveLiveness(v, now);
  return out;
}

function sameLiveness(a: Record<string, MeshLiveness>, b: Record<string, MeshLiveness>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** What a returned job means for the row that asked. */
export function outcomeOfJob(job: RemoteJob): MeshOutcome {
  const base = { jobId: job.id, peerId: job.peerId };
  switch (job.status) {
    case 'queued':
      return { ...base, state: 'queued', reason: null };
    case 'refused':
    case 'failed':
    case 'cancelled':
      return { ...base, state: 'refused', reason: job.refusalReason ?? job.summary ?? null };
    default:
      return { ...base, state: 'accepted', reason: null };
  }
}

export interface MeshSlice {
  /** This device first (`isSelf`), then every paired device. */
  meshDevices: MeshDeviceView[];
  /** Each device's effective liveness (client clock applied); rewritten only on change. */
  meshLiveness: Record<string, MeshLiveness>;
  /** The latest sample of every live run on this device, keyed by `runId`. */
  liveSamples: Record<string, LiveResourceSample>;
  meshFilter: MeshFilter;
  /** Row key -> the last verb that row sent. */
  meshOutcomes: Record<string, MeshOutcome>;
  /** Dev-fixture latch: reconcile reads are skipped while it is set. */
  meshPinned: boolean;

  refreshMeshDevices: () => Promise<void>;
  refreshLiveSamples: () => Promise<void>;
  /** Replace one device's view by `peerId` (from `network:device-snapshot`). */
  applyDeviceSnapshot: (view: MeshDeviceView) => void;
  /** Replace the whole sample map (from `fleet-resource-sample`). */
  applyResourceSamples: (list: readonly LiveResourceSample[]) => void;
  /** Re-decide liveness against `now`; a no-op unless a device's answer changed. */
  tickMeshLiveness: (now?: number) => void;
  setMeshFilter: (filter: MeshFilter) => void;
  toggleRemoteAgent: (peerId: string, personaId: string, enabled: boolean) => Promise<MeshOutcome>;
  remoteQueueVerb: (peerId: string, payload: MeshVerbPayload) => Promise<MeshOutcome>;
  moveQueuedToDevice: (sessionId: string, peerId: string) => Promise<MeshOutcome>;
}

export const createMeshSlice: StateCreator<SystemStore, [], [], MeshSlice> = (set, get) => {
  /** Bumped by every sample PUSH; a read issued under an older value is stale. */
  let samplesEpoch = 0;

  const replaceSamples = (list: readonly LiveResourceSample[] | null | undefined) => {
    if (!Array.isArray(list) || list.length === 0) {
      if (get().liveSamples !== NO_SAMPLES) set({ liveSamples: NO_SAMPLES });
      return;
    }
    const next: Record<string, LiveResourceSample> = {};
    for (const sample of list) next[sample.runId] = sample;
    set({ liveSamples: next });
  };

  // A read that answers nothing usable (a build or a harness answering `null`)
  // is an empty mesh, never a throw.
  const setDevices = (views: MeshDeviceView[] | null | undefined) => {
    const meshDevices = Array.isArray(views) && views.length > 0 ? views : NO_DEVICES;
    const next = livenessOf(meshDevices, Date.now());
    set((s) => ({ meshDevices, ...(sameLiveness(s.meshLiveness, next) ? {} : { meshLiveness: next }) }));
  };

  /** Run one verb for the row `key`; never throws, the row shows the outcome. */
  const runVerb = async (
    key: string,
    site: string,
    peerId: string,
    call: () => Promise<RemoteJob>,
  ): Promise<MeshOutcome> => {
    set((s) => ({ meshOutcomes: { ...s.meshOutcomes, [key]: { state: 'pending', reason: null, jobId: null, peerId } } }));
    let outcome: MeshOutcome;
    try {
      const job = await call();
      get().applyRemoteJobUpdate(job);
      outcome = outcomeOfJob(job);
    } catch (err) {
      silentCatch(`mesh:${site}`)(err);
      outcome = { state: 'refused', reason: resolveError(extractMessage(err)).message, jobId: null, peerId };
    }
    set((s) => ({ meshOutcomes: { ...s.meshOutcomes, [key]: outcome } }));
    return outcome;
  };

  return {
    meshDevices: NO_DEVICES,
    meshLiveness: {},
    liveSamples: NO_SAMPLES,
    meshFilter: 'all',
    meshOutcomes: {},
    meshPinned: false,

    refreshMeshDevices: async () => {
      if (get().meshPinned) return;
      try {
        const read = await meshDeviceSnapshots();
        if (!Array.isArray(read)) return setDevices(null);
        // Newest-wins per device: a push that landed during the read stays.
        const held = new Map(get().meshDevices.map((d) => [d.peerId, d]));
        setDevices(read.map((d) => {
          const mine = held.get(d.peerId);
          return mine && (mine.receivedAtMs ?? 0) > (d.receivedAtMs ?? 0) ? mine : d;
        }));
      } catch (err) {
        silentCatch('mesh:devices')(err);
      }
    },

    refreshLiveSamples: async () => {
      if (get().meshPinned) return;
      const epoch = samplesEpoch;
      try {
        const read = await resourceLiveSamples();
        if (epoch === samplesEpoch) replaceSamples(read);
      } catch (err) {
        silentCatch('mesh:samples')(err);
      }
    },

    applyDeviceSnapshot: (view) => {
      const list = get().meshDevices;
      const at = list.findIndex((d) => d.peerId === view.peerId);
      setDevices(at < 0 ? [...list, view] : list.map((d, i) => (i === at ? view : d)));
    },

    applyResourceSamples: (list) => {
      samplesEpoch += 1;
      replaceSamples(list);
    },

    tickMeshLiveness: (now = Date.now()) => {
      const next = livenessOf(get().meshDevices, now);
      if (!sameLiveness(get().meshLiveness, next)) set({ meshLiveness: next });
    },

    setMeshFilter: (meshFilter) => set({ meshFilter }),

    toggleRemoteAgent: (peerId, personaId, enabled) =>
      runVerb(agentOutcomeKey(peerId, personaId), 'toggle', peerId, () =>
        meshSendVerb(peerId, { verb: 'persona_set_enabled', personaId, enabled })),

    remoteQueueVerb: (peerId, payload) =>
      runVerb(queueOutcomeKey(peerId), payload.verb, peerId, () => meshSendVerb(peerId, payload)),

    moveQueuedToDevice: (sessionId, peerId) =>
      runVerb(moveOutcomeKey(sessionId), 'move', peerId, () => meshQueueMove(sessionId, peerId)),
  };
};
