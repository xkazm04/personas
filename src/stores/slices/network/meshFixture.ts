/**
 * Dev fixture for the device-mesh surfaces - screenshots and hand checks while
 * the backend commands are stubs (`mesh_device_snapshots` answers `[]` until
 * spark device-mesh WP2a lands).
 *
 * Seeds `meshSlice` with THIS device and TWO paired devices:
 *
 *   1. Studio Desktop - live (snapshot 3 s old), four agents (one running, one
 *                       off, one whose project is switched off), a queue of
 *                       three and a passed probe;
 *   2. Travel Laptop  - unknown (snapshot six minutes old, offline), two
 *                       agents, a queue of one and a failed probe.
 *
 * plus live samples for the local running sessions and personas given (or,
 * by default, every running fleet session in the store). Seeding sets
 * `meshPinned`, so the reconcile reads are skipped and the seeded strip
 * survives them. Modelled on `remoteSessionsFixture.ts`.
 *
 * Attached in dev and test-automation builds as
 * `window.__meshFixture = { seed, clear }`.
 */
import type { DeviceAgent } from '@/lib/bindings/DeviceAgent';
import type { DeviceQueueEntry } from '@/lib/bindings/DeviceQueueEntry';
import type { LiveResourceSample } from '@/lib/bindings/LiveResourceSample';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { ResourceAxis } from '@/lib/bindings/ResourceAxis';
import { useSystemStore } from '@/stores/systemStore';

export const FIXTURE_SELF_PEER_ID = 'fixture-self-0b5d2e61';
export const FIXTURE_STUDIO_PEER_ID = 'fixture-studio-7c1e9a04';
export const FIXTURE_LAPTOP_PEER_ID = 'fixture-laptop-3a90f4c2';

export interface MeshFixtureOptions {
  /** Local fleet session ids that get a live sample. */
  sessionIds?: string[];
  /** Local persona ids whose dominant axis this device reports. */
  personaIds?: string[];
}

const AXES: ResourceAxis[] = ['cpu', 'ram', 'gpu'];

function agent(personaId: string, name: string, over: Partial<DeviceAgent> = {}): DeviceAgent {
  return { personaId, name, enabled: true, projectId: null, projectEnabled: null, dominant: null, running: false, ...over };
}

function queued(sessionId: string, title: string, rank: number, projectLabel: string | null): DeviceQueueEntry {
  return { sessionId, title, projectLabel, rank, machineUnits: 1, gpu: 'none' };
}

function device(
  peerId: string,
  displayName: string,
  now: number,
  over: Partial<MeshDeviceView>,
  snap: Partial<NonNullable<MeshDeviceView['snapshot']>>,
): MeshDeviceView {
  const sentAtMs = over.receivedAtMs ?? now - 3_000;
  return {
    peerId, displayName, isSelf: false, isHome: false, reachability: 'connected', liveness: 'live',
    receivedAtMs: now - 3_000, lastProbe: null,
    ...over,
    snapshot: {
      peerId, displayName, appVersion: '0.9.4', sentAtMs,
      host: { cpuShare: 0.2, ramShare: 0.4, gpuShare: null },
      running: 0, queued: 0, agents: [], queue: [],
      ...snap,
    },
  };
}

/** Seed the slice. Returns the two peer ids (live, unknown). */
export function seedMeshFixture(opts: MeshFixtureOptions = {}): string[] {
  const now = Date.now();
  const store = useSystemStore.getState();
  const sessionIds = opts.sessionIds
    ?? store.fleetSessions.filter((s) => s.state === 'running').map((s) => s.id);
  const personaIds = opts.personaIds ?? [];

  const self = device(FIXTURE_SELF_PEER_ID, 'Workstation', now, { isSelf: true, isHome: true, receivedAtMs: now }, {
    host: { cpuShare: 0.46, ramShare: 0.58, gpuShare: 0.12 },
    running: sessionIds.length,
    queued: store.fleetQueue?.queued ?? 0,
    agents: personaIds.map((id, i) => agent(id, id, { dominant: AXES[i % AXES.length] ?? 'cpu' })),
  });

  const studio = device(FIXTURE_STUDIO_PEER_ID, 'Studio Desktop', now, {
    lastProbe: { peerId: FIXTURE_STUDIO_PEER_ID, testId: 't4_queue_move', passed: true, detail: 'Accepted in 1.2 s', atMs: now - 40 * 60_000 },
  }, {
    host: { cpuShare: 0.71, ramShare: 0.34, gpuShare: 0.82 },
    running: 2,
    queued: 3,
    agents: [
      agent('fixture-studio-render', 'Render Farm', { running: true, dominant: 'gpu' }),
      agent('fixture-studio-indexer', 'Code Indexer', { running: true, dominant: 'cpu' }),
      agent('fixture-studio-digest', 'Morning Digest', { enabled: false, dominant: 'ram' }),
      agent('fixture-studio-site', 'Site Builder', { projectId: 'fixture-site', projectEnabled: false }),
    ],
    queue: [
      queued('fixture-studio-q1', 'Bake the lighting pass', 1, 'garden-vr'),
      queued('fixture-studio-q2', 'Reindex the docs corpus', 2, 'docs'),
      queued('fixture-studio-q3', 'Upscale the trailer frames', 3, 'media'),
    ],
  });

  const laptop = device(FIXTURE_LAPTOP_PEER_ID, 'Travel Laptop', now, {
    reachability: 'offline',
    liveness: 'unknown',
    receivedAtMs: now - 6 * 60_000,
    lastProbe: { peerId: FIXTURE_LAPTOP_PEER_ID, testId: 't2_snapshot', passed: false, detail: 'No snapshot within 45 s', atMs: now - 6 * 60_000 },
  }, {
    host: { cpuShare: 0.08, ramShare: 0.22, gpuShare: null },
    queued: 1,
    agents: [
      agent('fixture-laptop-notes', 'Meeting Notes', { dominant: 'ram' }),
      agent('fixture-laptop-mail', 'Mail Triage', { dominant: 'cpu' }),
    ],
    queue: [queued('fixture-laptop-q1', 'Sync the reading list', 1, null)],
  });

  const samples: LiveResourceSample[] = [
    ...sessionIds.map((runId, i): LiveResourceSample => ({
      runKind: 'fleet', runId, personaId: null, cpuShare: [0.38, 0.12, 0.05][i % 3] ?? 0.1,
      ramShare: [0.14, 0.31, 0.04][i % 3] ?? 0.1, gpuShare: [0.02, 0.01, 0.27][i % 3] ?? null,
      dominant: (['cpu', 'ram', 'gpu'] as const)[i % 3] ?? 'cpu', atMs: now - 2_000,
    })),
    ...personaIds.slice(0, 1).map((personaId): LiveResourceSample => ({
      runKind: 'execution', runId: `fixture-exec-${personaId}`, personaId, cpuShare: 0.22, ramShare: 0.09,
      gpuShare: null, dominant: 'cpu', atMs: now - 2_000,
    })),
  ];

  useSystemStore.setState({ meshPinned: true });
  const s = useSystemStore.getState();
  for (const view of [self, studio, laptop]) s.applyDeviceSnapshot(view);
  s.applyResourceSamples(samples);
  return [FIXTURE_STUDIO_PEER_ID, FIXTURE_LAPTOP_PEER_ID];
}

/** Drop the fixture and hand the slice back to the reconcile. */
export function clearMeshFixture(): void {
  useSystemStore.setState({ meshPinned: false, meshDevices: [], meshLiveness: {}, liveSamples: {}, meshFilter: 'all', meshOutcomes: {} });
}

type FixtureWindow = Window & {
  __meshFixture?: { seed: typeof seedMeshFixture; clear: typeof clearMeshFixture };
};

/** Expose the fixture on `window` for the devtools console. */
export function attachMeshFixture(): void {
  if (typeof window === 'undefined') return;
  (window as FixtureWindow).__meshFixture = { seed: seedMeshFixture, clear: clearMeshFixture };
}
