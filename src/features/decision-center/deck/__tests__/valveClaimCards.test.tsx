/**
 * The valve walk and the Accept (claim) shape (mandate-lanes WP5):
 *  - valve: one irreversible item per step ("Valve 1 of 2"), armed on the
 *    first A and written only on the second, never more than one per verdict;
 *  - claim: the met-when checklist reads the goal's own conditions
 *    (`goal_met_when`): the KPI checked against its target, the UAT and the
 *    council listed without a tick; none set is said in one line;
 *    the audit sample lists the mandate's acts, 1-3 pick one, V reverts it
 *    through the act's own door; A still accepts the claim.
 *  - council: the card says the council never admits work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { en } from '@/i18n/en';
import { item } from '../../__tests__/rosterFixtures';
import type { MonitorCopy } from '../deckMeta';
import { act, laneEntry, mandate } from '../../mandate/__tests__/mandateFixtures';
import { useDecisionDeckStore } from '../deckStore';
import { digit, key, mountLane } from './shapeKit';

const api = vi.hoisted(() => ({
  listCharterActs: vi.fn(),
  revertCharterAct: vi.fn(async () => ({})),
  amendMandate: vi.fn(async () => ({})),
  resumeMandate: vi.fn(async () => ({})),
  suspendMandate: vi.fn(async () => ({})),
  getGoalMetWhen: vi.fn(),
}));
vi.mock('@/api/mandates', () => api);
vi.mock('../../lanes/useLanesSnapshot', () => ({ useCharterActRecorded: () => {} }));
vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor as MonitorCopy;

afterEach(() => useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null }));

describe('valve walk', () => {
  it('walks one valve at a time, each armed twice', async () => {
    const valves = [
      item({ id: 'approval:1', kind: 'approval', title: 'Email the client', irreversible: 'outbound-message', createdAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'approval:2', kind: 'approval', title: 'Delete the branch', irreversible: 'deletion', createdAt: '2026-10-02T00:00:00Z' }),
    ];
    const entries = valves.map((v) => laneEntry(v.id, { clause: 'valve', coalesceKey: v.id, irreversible: v.irreversible ?? null }));
    const { onDecide } = mountLane('breach', valves, entries);
    expect((await screen.findByTestId('valve-step')).textContent).toContain('Valve 1 of 2');
    key('a');
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('deck-armed-box').textContent).toContain('Email the client');
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0].item.id).toBe('approval:1');
    expect((await screen.findByText(/Valve 2 of 2/)).textContent).toContain('Valve 2 of 2');
  });
});

describe('Accept claim', () => {
  const goal = item({
    id: 'goal:g1', sourceId: 'g1', payload: { kpiId: 'k1' }, kind: 'goal', title: 'Activation reaches 50%', verdictLabels: { accept: 'Accept', reject: 'Send back', skip: 'Later' },
    facts: [{ id: 'kpi', label: 'KPI', value: 'Activation' }, { id: 'progress', label: 'Progress', value: '52 → 50 %', tone: 'success' }],
  });

  it('shows met-when and an audit sample; 1 picks an act and V reverts it', async () => {
    api.listCharterActs.mockResolvedValue([act('a1', { actor: 'steward', itemKind: 'idea' }), act('a2'), act('env', { itemKind: 'mandate' })]);
    api.getGoalMetWhen.mockResolvedValue({ goalId: 'g1', charterId: null, unreadable: false, metWhen: { uat: 'Sign in on a fresh install', kpiId: 'k1', council: 'full' } });
    const { onDecide } = mountLane('accept', [goal], [laneEntry('goal:g1', { lane: 'accept', clause: 'none' })], { mandates: [mandate()] });
    expect((await screen.findByTestId('claim-met-kpi')).textContent).toContain('Activation reached its target (52 → 50 %)');
    expect(screen.getByTestId('claim-met-uat').textContent).toContain('UAT: Sign in on a fresh install');
    expect(screen.getByTestId('claim-met-council').textContent).toContain(m.ml_claim_met_council_full);
    expect((await screen.findByTestId('claim-audit')).textContent).toContain('2 of 2 acts on this mandate');
    digit(1);
    const picked = screen.getByTestId('claim-act-1');
    expect(picked.getAttribute('aria-checked')).toBe('true');
    key('v');
    await waitFor(() => expect(api.revertCharterAct).toHaveBeenCalledTimes(1));
    expect(['a1', 'a2']).toContain(api.revertCharterAct.mock.calls[0]![0]);
    expect(onDecide).not.toHaveBeenCalled();
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept' })));
  });

  it('says plainly when the goal sets no condition, and when its conditions cannot be read', async () => {
    api.listCharterActs.mockResolvedValue([]);
    api.getGoalMetWhen.mockResolvedValue({ goalId: 'g1', charterId: null, unreadable: false, metWhen: null });
    mountLane('accept', [goal], [laneEntry('goal:g1', { lane: 'accept', clause: 'none' })], { mandates: [mandate()] });
    await waitFor(() => expect(screen.getByTestId('claim-met-when').getAttribute('data-state')).toBe('note'));
    expect(screen.getByTestId('claim-met-when').textContent).toBe(m.ml_claim_met_none);
    expect(screen.queryByRole('list', { name: '' })).toBeNull();
  });

  it('a met-when read that fails is said, never shown as no conditions', async () => {
    api.listCharterActs.mockResolvedValue([]);
    api.getGoalMetWhen.mockRejectedValue(new Error('down'));
    mountLane('accept', [goal], [laneEntry('goal:g1', { lane: 'accept', clause: 'none' })], { mandates: [mandate()] });
    await waitFor(() => expect(screen.getByTestId('claim-met-when').textContent).toBe(m.ml_claim_met_failed));
  });

  it('says there is nothing to audit when no mandate holds the project', async () => {
    api.listCharterActs.mockClear();
    mountLane('accept', [goal], [laneEntry('goal:g1', { lane: 'accept', clause: 'none', charterId: null })]);
    expect(await screen.findByText(m.ml_claim_audit_orphan)).toBeTruthy();
    expect(api.listCharterActs).not.toHaveBeenCalled();
  });
});

describe('council', () => {
  it('says the council never admits work', async () => {
    const council = item({ id: 'council:s1', kind: 'council', title: 'Redesign the board', document: { format: 'markdown', content: '# Verdict\n\nReady.' } });
    mountLane('accept', [council], [laneEntry('council:s1', { lane: 'accept', clause: 'none' })]);
    expect((await screen.findByTestId('council-never-admits')).textContent).toContain(m.ml_council_never_admits);
  });
});
