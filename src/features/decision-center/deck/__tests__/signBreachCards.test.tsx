/**
 * The Sign and Breach card shapes, driven by keys through the real deck
 * (mandate-lanes WP5):
 *  - Sign: the merge policy is a live choice and is what gets signed; a grant
 *    of merge ARMS the signature and lists it; info reviews raise the
 *    "cannot be undone" warning; X drops with a reason; the forecast reads
 *    the held count and says the per-item forecast is not available.
 *  - Breach: the clause in words; 1 widens the scope (with its diff), 1 on a
 *    merge clause arms first; 2 denies with a clause reason; 3 suspends; A is
 *    inert; the item's own branch moves to 4; a stop shows the incident sheet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { en } from '@/i18n/en';
import { item } from '../../__tests__/rosterFixtures';
import type { MonitorCopy } from '../deckMeta';
import { mandateToDecision } from '../../mandate/mandateItem';
import { laneEntry, mandate } from '../../mandate/__tests__/mandateFixtures';
import { useDecisionDeckStore } from '../deckStore';
import { digit, key, mountLane } from './shapeKit';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));
vi.mock('@/api/agents/responsibilities', () => ({
  listPersonaResponsibilities: vi.fn(async () => [{ id: 'c1', refusalClasses: ['custom:payments'] }]),
}));

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor as MonitorCopy;
const tx = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

afterEach(() => useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null }));

describe('Sign card', () => {
  const draft = mandate({ status: 'draft', envelope: { envelopeVersion: 0 } });
  const card = mandateToDecision(draft, m, tx, 'Later');
  const mount = () => mountLane('sign', [card], [laneEntry('mandate:c1', { lane: 'sign', clause: 'none' })], {
    mandates: [draft],
    charters: [{ charterId: 'c1', projectId: 'p1', status: 'draft', envelopeVersion: 0, held: 3 }],
  });

  it('signs the envelope as shown: never merge, no grant, one press', async () => {
    const { onDecide } = mount();
    await screen.findByTestId('sign-body');
    expect(screen.getByRole('radio', { name: m.ml_merge_never }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('sign-forecast').textContent).toContain('3 items held on this draft');
    expect(screen.getByTestId('sign-forecast').textContent).toContain(m.ml_sign_forecast_unavailable);
    expect(await screen.findByText('custom:payments')).toBeTruthy();
    // The key map speaks the shape's own grammar.
    key('?');
    expect(screen.getByTestId('deck-key-legend').textContent).toContain(m.ml_keys_edit);
    key('Escape');
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0]).toMatchObject({ verdict: 'accept', envelope: { mergePolicy: 'never', decideScopes: [], budgetMonthlyUsd: null } });
  });

  it('captures the merge policy the operator picks, and arms because it grants a merge', async () => {
    const { onDecide } = mount();
    await screen.findByTestId('sign-body');
    fireEvent.click(screen.getByRole('radio', { name: m.ml_merge_gate_green }));
    key('a');
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-grants-box').textContent).toContain(`Merges land without you ${m.ml_merge_gate_green}`);
    key('Enter');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0].envelope).toMatchObject({ mergePolicy: 'gate-green' });
  });

  it('warns that info review approvals cannot be undone once that scope is granted', async () => {
    mount();
    await screen.findByTestId('sign-body');
    expect(screen.queryByTestId('sign-review-final')).toBeNull();
    key('e');
    fireEvent.click(screen.getByTestId('sign-scope-review.info'));
    expect(screen.getByTestId('sign-review-final').textContent).toContain(m.ml_sign_review_final);
  });

  it('drops with a one-key reason; R is inert on a Sign card', async () => {
    const { onDecide } = mount();
    await screen.findByTestId('sign-body');
    key('r');
    expect(screen.queryByTestId('deck-reason')).toBeNull();
    key('x');
    expect(screen.getByTestId('deck-reason')).toBeTruthy();
    digit(1);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'reject', reason: 'Not a goal I hold' })));
  });
});

describe('Breach card', () => {
  const signed = mandate();
  const idea = item({ id: 'idea:1', kind: 'idea', title: 'Cache the board', verdictLabels: { accept: 'Accept', reject: 'Reject', skip: 'Later' }, branches: [{ id: 'build', label: 'Build it now' }] });

  it('says the clause, shows the diff, and 1 widens the scope', async () => {
    const { onDecide } = mountLane('breach', [idea], [laneEntry('idea:1', { clause: 'scope' })], { mandates: [signed] });
    await screen.findByTestId('breach-body');
    expect(screen.getByTestId('breach-clause').textContent).toContain(m.ml_clause_scope);
    expect(screen.getByTestId('breach-diff').textContent).toContain(`+ ${m.ml_scope_idea_accept}`);
    // The item's own branch moves up past the shape's three digits.
    expect(within(screen.getByRole('button', { name: 'Build it now' })).getByText('4')).toBeTruthy();
    key('a');
    expect(onDecide).not.toHaveBeenCalled();
    digit(1);
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0]).toMatchObject({ mandateAct: { op: 'amend', charterId: 'c1', change: { kind: 'widenScope', scopes: ['idea.accept'] } } });
  });

  it('arms a merge amend first and lets merges land on the second press', async () => {
    const review = item({ id: 'review:9', kind: 'review', title: 'Merge the parser' });
    const { onDecide } = mountLane('breach', [review], [laneEntry('review:9', { clause: 'merge' })], { mandates: [signed] });
    await screen.findByTestId('breach-body');
    digit(1);
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('deck-armed-box')).toBeTruthy();
    key('Enter');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0].mandateAct).toMatchObject({ change: { kind: 'setMergePolicy', policy: 'gate-green' } });
  });

  it('2 denies with a clause reason, 3 suspends the mandate', async () => {
    const two = [idea, item({ id: 'idea:2', kind: 'idea', title: 'Second idea' })];
    const { onDecide } = mountLane('breach', two, [laneEntry('idea:1', { clause: 'scope' }), laneEntry('idea:2', { clause: 'scope' })], { mandates: [signed] });
    await screen.findByTestId('breach-body');
    expect(screen.getByTestId('deck-fold-behind').textContent).toContain('1 more item on the same clause');
    digit(2);
    digit(1);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'reject', reason: 'Not for this mandate' })));
    await screen.findByText('Second idea');
    digit(3);
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(2));
    expect(onDecide.mock.calls[1]![0].mandateAct).toEqual({ op: 'suspend', charterId: 'c1' });
  });

  it('a stop breach shows the incident sheet and amends by deciding the incident itself', async () => {
    const incident = item({ id: 'incident:7', kind: 'incident', severity: 'high', title: 'Builds failing', facts: [{ id: 'status', label: 'Status', value: 'open' }] });
    const { onDecide } = mountLane('breach', [incident], [laneEntry('incident:7', { clause: 'stop' })], { mandates: [signed] });
    await screen.findByTestId('breach-incident-sheet');
    expect(screen.queryByTestId('breach-diff')).toBeNull();
    digit(1);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept' })));
    expect(onDecide.mock.calls[0]![0].mandateAct).toBeUndefined();
  });
});
