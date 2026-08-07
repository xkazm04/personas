import { describe, it, expect } from 'vitest';
import {
  MAX_REMOTE_JOB_NOTICES,
  RUNNING_NOTICE_TTL_MS,
  TERMINAL_NOTICE_TTL_MS,
  activeRemoteJobNotice,
  isTerminalNoticePhase,
  reduceRemoteJobNotices,
  type RemoteJobNotice,
  type RemoteJobTurnEvent,
} from '../remoteJobNotice';

const T0 = 1_760_000_000_000;

function turn(over: Partial<RemoteJobTurnEvent> = {}): RemoteJobTurnEvent {
  return {
    jobId: 'job-1',
    source: 'Laptop',
    instruction: 'summarise the build failures',
    phase: 'started',
    summary: '',
    ...over,
  };
}

const fire = (state: readonly RemoteJobNotice[], event: RemoteJobTurnEvent, now = T0) =>
  reduceRemoteJobNotices(state, { type: 'turn', event, now });

describe('isTerminalNoticePhase', () => {
  it('is true only for completed and failed', () => {
    expect(isTerminalNoticePhase('started')).toBe(false);
    expect(isTerminalNoticePhase('completed')).toBe(true);
    expect(isTerminalNoticePhase('failed')).toBe(true);
  });
});

describe('reduceRemoteJobNotices — the happy path', () => {
  it('opens a notice on started, naming the source device', () => {
    const state = fire([], turn());
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ jobId: 'job-1', source: 'Laptop', phase: 'started' });
  });

  it('updates the same notice in place on completed, carrying the summary', () => {
    let state = fire([], turn());
    state = fire(state, turn({ phase: 'completed', summary: 'Three failures, all in the ORT step.' }), T0 + 5_000);
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ phase: 'completed', summary: 'Three failures, all in the ORT step.' });
    expect(state[0]?.updatedAt).toBe(T0 + 5_000);
  });

  it('updates in place on failed too', () => {
    let state = fire([], turn());
    state = fire(state, turn({ phase: 'failed', summary: 'the turn timed out' }), T0 + 1_000);
    expect(state).toHaveLength(1);
    expect(state[0]?.phase).toBe('failed');
  });

  it('shows the most recently changed notice first', () => {
    let state = fire([], turn({ jobId: 'a' }));
    state = fire(state, turn({ jobId: 'b', source: 'Desktop' }), T0 + 1);
    expect(activeRemoteJobNotice(state)?.jobId).toBe('b');
    // Job A settling brings it back to the front.
    state = fire(state, turn({ jobId: 'a', phase: 'completed' }), T0 + 2);
    expect(activeRemoteJobNotice(state)?.jobId).toBe('a');
  });
});

describe('reduceRemoteJobNotices — out-of-order and missed events', () => {
  it('ignores a started that arrives after its own terminal phase', () => {
    let state = fire([], turn({ phase: 'completed', summary: 'done' }));
    const settled = state;
    state = fire(state, turn({ phase: 'started' }), T0 + 1_000);
    expect(state).toBe(settled);
    expect(state[0]?.phase).toBe('completed');
  });

  it('keeps the FIRST terminal phase when a second one arrives', () => {
    let state = fire([], turn());
    state = fire(state, turn({ phase: 'completed', summary: 'done' }), T0 + 10);
    const settled = state;
    state = fire(state, turn({ phase: 'failed', summary: 'no, broken' }), T0 + 20);
    expect(state).toBe(settled);
    expect(state[0]).toMatchObject({ phase: 'completed', summary: 'done' });
  });

  it('still surfaces a terminal phase for a job whose started was missed', () => {
    const state = fire([], turn({ phase: 'completed', summary: 'done' }));
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ phase: 'completed', source: 'Laptop' });
  });

  it('keeps what it already learned when a late payload arrives thin', () => {
    let state = fire([], turn({ source: 'Laptop', instruction: 'audit the vault' }));
    state = fire(state, turn({ phase: 'completed', source: '', instruction: '', summary: 'ok' }), T0 + 10);
    expect(state[0]).toMatchObject({ source: 'Laptop', instruction: 'audit the vault' });
  });

  it('ignores a duplicate event for the phase it is already in', () => {
    const state = fire([], turn());
    expect(fire(state, turn(), T0 + 500)).toBe(state);
  });

  it('ignores a phase it does not understand rather than showing an unclearable chip', () => {
    const state = fire([], turn({ phase: 'wedged' }));
    expect(state).toEqual([]);
  });

  it('ignores an event with no job id', () => {
    expect(fire([], turn({ jobId: '   ' }))).toEqual([]);
  });
});

describe('reduceRemoteJobNotices — expiry', () => {
  it('clears a settled notice once its short TTL elapses', () => {
    const state = fire([], turn({ phase: 'completed', summary: 'done' }));
    expect(reduceRemoteJobNotices(state, { type: 'expire', now: T0 + TERMINAL_NOTICE_TTL_MS - 1 })).toBe(state);
    expect(reduceRemoteJobNotices(state, { type: 'expire', now: T0 + TERMINAL_NOTICE_TTL_MS })).toEqual([]);
  });

  it('sweeps a started notice whose terminal event never arrived', () => {
    const state = fire([], turn());
    // Inside the turn ceiling the errand may genuinely still be running.
    expect(reduceRemoteJobNotices(state, { type: 'expire', now: T0 + 20 * 60_000 })).toBe(state);
    expect(reduceRemoteJobNotices(state, { type: 'expire', now: T0 + RUNNING_NOTICE_TTL_MS })).toEqual([]);
  });

  it('returns the same reference when nothing expired', () => {
    const state = fire([], turn());
    expect(reduceRemoteJobNotices(state, { type: 'expire', now: T0 + 1 })).toBe(state);
  });
});

describe('reduceRemoteJobNotices — dismiss, reset and the cap', () => {
  it('dismisses one notice by job id', () => {
    let state = fire([], turn({ jobId: 'a' }));
    state = fire(state, turn({ jobId: 'b' }), T0 + 1);
    state = reduceRemoteJobNotices(state, { type: 'dismiss', jobId: 'a' });
    expect(state.map((n) => n.jobId)).toEqual(['b']);
  });

  it('returns the same reference when dismissing something that is not there', () => {
    const state = fire([], turn());
    expect(reduceRemoteJobNotices(state, { type: 'dismiss', jobId: 'nope' })).toBe(state);
  });

  it('resets to empty, and is a no-op when already empty', () => {
    const state = fire([], turn());
    expect(reduceRemoteJobNotices(state, { type: 'reset' })).toEqual([]);
    const empty: RemoteJobNotice[] = [];
    expect(reduceRemoteJobNotices(empty, { type: 'reset' })).toBe(empty);
  });

  it('caps concurrent notices, dropping the oldest', () => {
    let state: RemoteJobNotice[] = [];
    for (let i = 0; i < MAX_REMOTE_JOB_NOTICES + 2; i += 1) {
      state = fire(state, turn({ jobId: `job-${i}` }), T0 + i);
    }
    expect(state).toHaveLength(MAX_REMOTE_JOB_NOTICES);
    expect(state[0]?.jobId).toBe(`job-${MAX_REMOTE_JOB_NOTICES + 1}`);
    expect(state.some((n) => n.jobId === 'job-0')).toBe(false);
  });
});

describe('activeRemoteJobNotice', () => {
  it('is null when nothing is live', () => {
    expect(activeRemoteJobNotice([])).toBeNull();
  });
});
