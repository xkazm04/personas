import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';

/**
 * Two things the rail used to get wrong, both invisible until the engine wrote
 * something unexpected:
 *
 *  1. `pendingAction` / `resolution` were `JSON.parse`d UNGUARDED in the
 *     component body. These blobs are written by the deliberation engine, not
 *     by this app, so one malformed row threw during render and the rail — the
 *     only surface carrying advance / stop / approve / escalation-decision —
 *     went blank with no way back except a reload.
 *  2. the status enum rendered verbatim, so an escalated deliberation captioned
 *     itself `awaiting_action` in every one of the 14 locales.
 */

// Every `t.section.key` resolves to the literal "section.key", so no catalog is
// needed and every leaf is a real string React can render.
const t = new Proxy(
  {},
  {
    get: (_o, section) =>
      new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }),
  },
);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));

vi.mock('@/features/teams/sub_teamWorkspace/teamStudio/boardShared', () => ({
  usePersonaIndex: () => new Map(),
}));

const detailRef: { current: TeamDeliberation | null } = { current: null };
const setSelectedId = vi.fn();
vi.mock('@/features/teams/sub_deliberations/useTeamDeliberations', () => ({
  useTeamDeliberations: () => ({
    detail: detailRef.current,
    setSelectedId,
    agenda: [],
    tracks: [],
    advancing: false,
    running: false,
    trackBusy: false,
    actionBusy: false,
    decisionBusy: false,
    advance: vi.fn(),
    runToBudget: vi.fn(),
    stopRun: vi.fn(),
    split: vi.fn(),
    merge: vi.fn(),
    runAllTracks: vi.fn(),
    approveAction: vi.fn(),
    skipAction: vi.fn(),
    resolveEscalation: vi.fn(),
    approve: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function deliberation(over: Partial<TeamDeliberation>): TeamDeliberation {
  return {
    id: 'd-1',
    teamId: 'team-1',
    topic: 'Ship the rail',
    goal: null,
    status: 'open',
    round: 2,
    consecutiveStallRounds: 0,
    costBudgetUsd: 5,
    costSpentUsd: 0.5,
    idleDeadline: null,
    resolution: null,
    spawnedAssignmentId: null,
    pendingAction: null,
    parentId: null,
    rosterIds: null,
    actionExecutionId: null,
    createdBy: 'user',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...over,
  };
}

async function mount() {
  const { DeliberationRail } = await import('../DeliberationRail');
  return render(<DeliberationRail teamId="team-1" deliberationId="d-1" />);
}

describe('DeliberationRail', () => {
  it('survives malformed engine JSON instead of throwing during render', async () => {
    detailRef.current = deliberation({
      pendingAction: '{not json',
      resolution: 'null}}',
    });
    await mount();
    // The rail is up: the topic and the run controls rendered, and neither the
    // capability card nor the proposal card was built from the garbage.
    expect(screen.getByText('Ship the rail')).toBeTruthy();
    expect(screen.getByText('monitor.delib_advance')).toBeTruthy();
    expect(screen.queryByText('monitor.delib_capability')).toBeNull();
    expect(screen.queryByText('monitor.delib_proposal')).toBeNull();
  });

  it('parses well-formed blobs into their cards', async () => {
    detailRef.current = deliberation({
      pendingAction: JSON.stringify({ persona_id: 'p-1', rationale: 'needs the repo' }),
      resolution: JSON.stringify({ title: 'Adopt the rail', summary: 'One surface, not two.' }),
    });
    await mount();
    expect(screen.getByText('monitor.delib_capability')).toBeTruthy();
    expect(screen.getByText('Adopt the rail')).toBeTruthy();
  });

  it('captions the status through i18n rather than leaking the enum', async () => {
    detailRef.current = deliberation({ status: 'awaiting_action' });
    const { container } = await mount();
    expect(container.textContent).toContain('deliberation.status_awaiting_action');
    expect(container.textContent).not.toMatch(/(^|\s)awaiting_action(\s|$)/);
  });
});
