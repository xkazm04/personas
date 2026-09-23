import { describe, expect, it } from 'vitest';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import {
  effectiveRemoteState,
  normalizeGitRemote,
  receiptVerdict,
  remoteLastSeenMs,
  REMOTE_MIRROR_STALE_MS,
  replaceRemoteSessionViews,
  upsertRemoteSessionView,
} from '../remoteSessionModel';

const NOW = 1_800_000_000_000;

function view(over: Partial<RemoteSessionView> = {}): RemoteSessionView {
  return {
    jobId: 'job-1',
    sessionId: null,
    peerId: 'peer-1',
    peerDisplayName: 'Desk',
    projectId: 'p1',
    projectLabel: 'repo',
    githubUrl: 'https://github.com/o/r',
    title: null,
    state: 'running',
    stateReason: null,
    mode: 'headless',
    createdAtMs: NOW - 60_000,
    lastActivityMs: NOW - 1_000,
    mirrorAtMs: NOW - 1_000,
    jobStatus: 'running',
    receipt: null,
    ...over,
  };
}

describe('effectiveRemoteState', () => {
  it('walks queued -> running -> unknown on a stale mirror -> completed', () => {
    // Waiting in the outbox: queued, whatever the (absent) mirror says.
    expect(effectiveRemoteState(view({ jobStatus: 'queued', state: 'unknown', mirrorAtMs: 0 }), NOW)).toBe('queued');
    // The peer took it and mirrors are fresh: the mirrored state.
    expect(effectiveRemoteState(view({ jobStatus: 'running', state: 'running', mirrorAtMs: NOW - 5_000 }), NOW)).toBe('running');
    // No mirror for longer than the rule: unknown, never running.
    const stale = view({ jobStatus: 'running', state: 'running', mirrorAtMs: NOW - REMOTE_MIRROR_STALE_MS - 1 });
    expect(effectiveRemoteState(stale, NOW)).toBe('unknown');
    // The job finished: the session is over, and never reads live.
    expect(effectiveRemoteState(view({ jobStatus: 'completed', state: 'running', mirrorAtMs: 0 }), NOW)).toBe('exited');
    expect(effectiveRemoteState(view({ jobStatus: 'completed', state: 'finished' }), NOW)).toBe('finished');
  });

  it('treats a running job that never mirrored as unknown', () => {
    expect(effectiveRemoteState(view({ mirrorAtMs: 0 }), NOW)).toBe('unknown');
  });

  it('grants a just-accepted session the same 45 s spawning grace as the backend, then turns unknown', () => {
    const fresh = view({ state: 'spawning', mirrorAtMs: 0, lastActivityMs: NOW - 10_000 });
    expect(effectiveRemoteState(fresh, NOW)).toBe('spawning');
    const lapsed = view({ state: 'spawning', mirrorAtMs: 0, lastActivityMs: NOW - REMOTE_MIRROR_STALE_MS - 1 });
    expect(effectiveRemoteState(lapsed, NOW)).toBe('unknown');
  });

  it('is exactly on the boundary at 45 s', () => {
    expect(effectiveRemoteState(view({ mirrorAtMs: NOW - REMOTE_MIRROR_STALE_MS }), NOW)).toBe('running');
  });

  it('never defaults an off-union state to running', () => {
    const bogus = view({ state: 'bogus' as never });
    expect(effectiveRemoteState(bogus, NOW)).toBe('unknown');
  });

  it('keeps a mirrored awaiting_input while fresh', () => {
    expect(effectiveRemoteState(view({ state: 'awaiting_input' }), NOW)).toBe('awaiting_input');
  });
});

describe('upsertRemoteSessionView', () => {
  it('inserts, and replaces with a newer mirror', () => {
    const a = upsertRemoteSessionView({}, view({ mirrorAtMs: NOW - 10_000 }));
    const b = upsertRemoteSessionView(a, view({ mirrorAtMs: NOW - 1_000, state: 'idle' }));
    expect(b['job-1']?.state).toBe('idle');
  });

  it('drops a late push that would walk a job backwards', () => {
    const done = upsertRemoteSessionView({}, view({ jobStatus: 'completed', state: 'exited' }));
    const late = upsertRemoteSessionView(done, view({ jobStatus: 'running', mirrorAtMs: NOW }));
    expect(late).toBe(done);
  });

  it('drops an older mirror at the same status', () => {
    const fresh = upsertRemoteSessionView({}, view({ mirrorAtMs: NOW }));
    expect(upsertRemoteSessionView(fresh, view({ mirrorAtMs: NOW - 5_000 }))).toBe(fresh);
  });

  it('a fetch keeps a pushed view that is newer than the fetched row', () => {
    const pushed = upsertRemoteSessionView({}, view({ jobStatus: 'completed', state: 'exited' }));
    const merged = replaceRemoteSessionViews(pushed, [view({ jobStatus: 'running' })]);
    expect(merged['job-1']?.jobStatus).toBe('completed');
  });
});

describe('receiptVerdict', () => {
  const r = { sessionId: 's', branch: 'remote/a/b', pushedSha: 'abc1234def', pushError: null, verified: true };
  it('names all five outcomes', () => {
    expect(receiptVerdict(r)).toBe('verified');
    expect(receiptVerdict({ ...r, verified: false })).toBe('unverified');
    expect(receiptVerdict({ ...r, verified: null })).toBe('could_not_verify');
    expect(receiptVerdict({ ...r, pushedSha: null })).toBe('not_pushed');
    expect(receiptVerdict({ ...r, pushedSha: null, pushError: 'auth failed' })).toBe('push_failed');
  });
});

describe('remoteLastSeenMs', () => {
  it('reads 0 as never, not the epoch', () => {
    expect(remoteLastSeenMs({ mirrorAtMs: 0, lastActivityMs: 0 })).toBeNull();
    expect(remoteLastSeenMs({ mirrorAtMs: 5, lastActivityMs: 9 })).toBe(9);
  });
});

describe('normalizeGitRemote', () => {
  it('equates https, ssh and scp-like forms of one repo', () => {
    const want = 'github.com/owner/repo';
    expect(normalizeGitRemote('https://github.com/Owner/Repo.git')).toBe(want);
    expect(normalizeGitRemote('git@github.com:owner/repo.git')).toBe(want);
    expect(normalizeGitRemote('ssh://git@github.com/owner/repo')).toBe(want);
    expect(normalizeGitRemote('https://token@github.com/owner/repo/')).toBe(want);
  });

  it('returns null for nothing', () => {
    expect(normalizeGitRemote(null)).toBeNull();
    expect(normalizeGitRemote('   ')).toBeNull();
  });
});
