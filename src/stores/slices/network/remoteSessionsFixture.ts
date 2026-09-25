/**
 * Dev fixture for the remote-sessions surfaces - screenshots and hand checks
 * while the backend commands are stubs (and in a lite build, which has no p2p).
 *
 * Seeds `remoteSessionsSlice` with ONE paired device and THREE remote views:
 *
 *   1. running    - mirror fresh, in the first local project that has both a
 *                   git remote and a team column (so it lands in that column);
 *   2. unknown    - job running, mirror five minutes old (renders dimmed);
 *   3. completed  - with a pushed, verified receipt.
 *
 * Views 2 and 3 carry a git remote no local project has, so they land in the
 * "On <device>" group. Seeding sets `remoteSessionsPinned`, which makes the
 * slice skip its reconcile loads so the seeded board survives them.
 *
 * Attached in dev and test-automation builds as
 * `window.__remoteSessionsFixture = { seed, tail, clear }`; `tail(jobId, text)`
 * writes a chunk into an open drawer's terminal mirror.
 */
import type { DispatchDevice } from '@/lib/bindings/DispatchDevice';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { publishRemoteSessionOutput } from '@/lib/network/remoteSessionOutput';
import { useSystemStore } from '@/stores/systemStore';

export const FIXTURE_PEER_ID = 'fixture-peer-7c1e9a04';
const FIXTURE_DEVICE: DispatchDevice = {
  peerId: FIXTURE_PEER_ID,
  displayName: 'Studio Desktop',
  isHome: false,
  reachability: 'connected',
};
const ELSEWHERE_URL = 'https://github.com/example/remote-only-repo';

function view(
  jobId: string,
  now: number,
  over: Partial<RemoteSessionView>,
): RemoteSessionView {
  return {
    jobId,
    sessionId: `${jobId}-session`,
    peerId: FIXTURE_PEER_ID,
    peerDisplayName: FIXTURE_DEVICE.displayName,
    projectId: 'fixture-project',
    projectLabel: 'remote-only-repo',
    githubUrl: ELSEWHERE_URL,
    title: null,
    state: 'running',
    stateReason: null,
    mode: 'headless',
    createdAtMs: now - 12 * 60_000,
    lastActivityMs: now - 5_000,
    mirrorAtMs: now - 5_000,
    jobStatus: 'running',
    receipt: null,
    ...over,
  };
}

/** Seed the slice. Returns the three job ids (running, unknown, completed). */
export function seedRemoteSessionsFixture(): string[] {
  const now = Date.now();
  const home = useSystemStore.getState().projects.find((p) => p.github_url && p.team_id) ?? null;
  const running = view('fixture-job-running', now, {
    title: 'Refactor the sync engine',
    ...(home ? { projectId: home.id, projectLabel: home.name, githubUrl: home.github_url ?? ELSEWHERE_URL } : {}),
  });
  const unknown = view('fixture-job-unknown', now, {
    title: 'Write the migration tests',
    mode: 'interactive',
    lastActivityMs: now - 5 * 60_000,
    mirrorAtMs: now - 5 * 60_000,
  });
  const completed = view('fixture-job-completed', now, {
    title: 'Fix the flaky login test',
    state: 'exited',
    jobStatus: 'completed',
    receipt: {
      sessionId: 'fixture-job-completed-session',
      branch: 'remote/7c1e9a04/3f2b8d11',
      pushedSha: '9e4c1a7b2d6f08c35e1a4b9d7c2f6e8a1b3d5c70',
      pushError: null,
      verified: true,
    },
  });
  useSystemStore.setState({
    remoteSessionsPinned: true,
    remoteSessionsSynced: true,
    dispatchDevices: [FIXTURE_DEVICE],
    remoteSessions: { [running.jobId]: running, [unknown.jobId]: unknown, [completed.jobId]: completed },
  });
  return [running.jobId, unknown.jobId, completed.jobId];
}

const tailSeq = new Map<string, number>();

/**
 * Push one chunk of terminal text to an open drawer's mirror, as the output
 * event would. `skip` jumps the sequence to show the "output skipped" marker.
 */
export function tailRemoteSessionsFixture(jobId: string, text: string, skip = 0): void {
  const seq = (tailSeq.get(jobId) ?? 0) + 1 + skip;
  tailSeq.set(jobId, seq);
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  publishRemoteSessionOutput({ jobId, seq, chunkB64: btoa(bin) });
}

/** Drop the fixture and hand the slice back to the reconcile. */
export function clearRemoteSessionsFixture(): void {
  useSystemStore.setState({ remoteSessionsPinned: false, remoteSessions: {}, dispatchDevices: [] });
}

type FixtureWindow = Window & {
  __remoteSessionsFixture?: {
    seed: typeof seedRemoteSessionsFixture;
    tail: typeof tailRemoteSessionsFixture;
    clear: typeof clearRemoteSessionsFixture;
  };
};

/** Expose the fixture on `window` for the devtools console. */
export function attachRemoteSessionsFixture(): void {
  if (typeof window === 'undefined') return;
  (window as FixtureWindow).__remoteSessionsFixture = {
    seed: seedRemoteSessionsFixture,
    tail: tailRemoteSessionsFixture,
    clear: clearRemoteSessionsFixture,
  };
}
