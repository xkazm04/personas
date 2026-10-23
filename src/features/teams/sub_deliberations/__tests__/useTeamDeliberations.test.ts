import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';

const api = vi.hoisted(() => ({
  getTeamDeliberation: vi.fn(),
  listDeliberationAgenda: vi.fn(),
  listDeliberationTurns: vi.fn(),
  listDeliberationTracks: vi.fn(),
  listTeamDeliberations: vi.fn(),
}));
vi.mock('@/api/pipeline/teamDeliberations', () => ({
  ...api,
  advanceTeamDeliberation: vi.fn(),
  approveDeliberationAction: vi.fn(),
  approveDeliberationProposal: vi.fn(),
  createTeamDeliberation: vi.fn(),
  dismissDeliberationProposal: vi.fn(),
  mergeDeliberationTracks: vi.fn(),
  pollDeliberationAction: vi.fn(),
  resolveDeliberationEscalation: vi.fn(),
  skipDeliberationAction: vi.fn(),
  splitTeamDeliberation: vi.fn(),
}));

import { useTeamDeliberations } from '../useTeamDeliberations';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
// `resolved` keeps the poll effect quiet (not an active status).
const delib = (id: string, teamId = 't1') => ({ id, teamId, status: 'resolved' }) as Partial<TeamDeliberation> as TeamDeliberation;

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.listDeliberationAgenda.mockResolvedValue([]);
  api.listDeliberationTurns.mockResolvedValue([]);
  api.listDeliberationTracks.mockResolvedValue([]);
});

describe('useTeamDeliberations: overlapping reads', () => {
  it('a slow read of the previously selected deliberation does not paint over the new selection', async () => {
    api.listTeamDeliberations.mockResolvedValue([]);
    const slowA = deferred<TeamDeliberation>();
    api.getTeamDeliberation.mockImplementation((id: string) =>
      id === 'A' ? slowA.promise : Promise.resolve(delib('B')),
    );
    const { result } = renderHook(() => useTeamDeliberations('t1'));
    await act(async () => { result.current.setSelectedId('A'); });
    await act(async () => { result.current.setSelectedId('B'); });
    expect(result.current.detail?.id).toBe('B');
    await act(async () => { slowA.resolve(delib('A')); });
    expect(result.current.detail?.id).toBe('B');
  });

  it("an old team's list landing after a team switch does not replace the new team's list", async () => {
    const slowT1 = deferred<TeamDeliberation[]>();
    api.listTeamDeliberations.mockImplementation((teamId: string) =>
      teamId === 't1' ? slowT1.promise : Promise.resolve([delib('x2', 't2')]),
    );
    const { result, rerender } = renderHook(({ team }) => useTeamDeliberations(team), {
      initialProps: { team: 't1' },
    });
    await act(async () => { rerender({ team: 't2' }); });
    expect(result.current.list.map((d) => d.id)).toEqual(['x2']);
    await act(async () => { slowT1.resolve([delib('x1')]); });
    expect(result.current.list.map((d) => d.id)).toEqual(['x2']);
  });
});
