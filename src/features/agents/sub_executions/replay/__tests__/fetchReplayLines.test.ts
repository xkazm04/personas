import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLines = vi.fn();
vi.mock('@/api/agents/executions', () => ({
  getExecutionLogLines: (...a: unknown[]) => getLines(...a),
}));

import { fetchReplayLines, REPLAY_MAX_LINES, REPLAY_PAGE_SIZE } from '../fetchReplayLines';

/** A fake log of `total` lines served by offset/limit like the backend. */
function serve(total: number) {
  getLines.mockImplementation(async (_e: string, _p: string, offset: number, limit: number) =>
    Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => `l${offset + i}`));
}

describe('fetchReplayLines', () => {
  beforeEach(() => getLines.mockReset());

  it('returns a run longer than one page completely', async () => {
    serve(1234);
    const lines = await fetchReplayLines('e', 'p');
    expect(lines).toHaveLength(1234);
    expect(lines[1233]).toBe('l1233');
    expect(getLines.mock.calls.every((c) => c[4] === true)).toBe(true);
  });

  it('stops after one call for a short run', async () => {
    serve(40);
    expect(await fetchReplayLines('e', 'p')).toHaveLength(40);
    expect(getLines).toHaveBeenCalledTimes(1);
  });

  it('terminates at the cap on an endless backend', async () => {
    serve(10 * REPLAY_MAX_LINES);
    expect(await fetchReplayLines('e', 'p')).toHaveLength(REPLAY_MAX_LINES);
    expect(getLines).toHaveBeenCalledTimes(REPLAY_MAX_LINES / REPLAY_PAGE_SIZE);
  });
});
