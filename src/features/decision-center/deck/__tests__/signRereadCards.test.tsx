/**
 * The Sign card after WP6, driven by keys through the real deck:
 *  - armed, the yes verb keeps its name ("Sign") and prints the confirm key;
 *    the grants it confirms are listed in the body, the rail keeps its blocks;
 *  - the ledger's cost tile says what signing releases, not "1 key";
 *  - X drops with the reason picked in the prompt (it reaches the verdict);
 *  - a re-read card is titled with its reason, keeps as signed on A (no
 *    envelope: `mandate_keep`), opens its edit with the suggestion applied,
 *    and signs the change once edited. It has no drop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { en } from '@/i18n/en';
import type { MandateReread } from '@/lib/bindings/MandateReread';
import type { MonitorCopy } from '../deckMeta';
import { mandateToDecision } from '../../mandate/mandateItem';
import { rereadToDecision } from '../../mandate/rereadItem';
import { laneEntry, mandate } from '../../mandate/__tests__/mandateFixtures';
import { useDecisionDeckStore } from '../deckStore';
import { key, mountLane } from './shapeKit';

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

describe('Sign card, armed', () => {
  const draft = mandate({ status: 'draft', envelope: { envelopeVersion: 0, mergePolicy: 'gate-green', budgetMonthlyUsd: 40 } });
  const card = mandateToDecision(draft, m, tx, 'Later', 3);
  const mount = () => mountLane('sign', [card], [laneEntry('mandate:c1', { lane: 'sign', clause: 'none' })], {
    mandates: [draft],
    charters: [{ charterId: 'c1', projectId: 'p1', status: 'draft', envelopeVersion: 0, held: 3 }],
  });

  it('keeps the verb and shows the confirm key; the grants sit in the body and the rail keeps its blocks', async () => {
    mount();
    await screen.findByTestId('sign-body');
    expect(screen.getByText('Releases 3 items')).toBeTruthy();
    expect(screen.queryByText(m.dc_deck_cost_one_key)).toBeNull();
    key('a');
    const verb = screen.getByTestId('sign-verb');
    expect(verb.getAttribute('data-armed')).toBe('');
    expect(verb.textContent).toContain(m.ml_sign_verb);
    expect(verb.textContent).toContain('↵');
    expect(verb.textContent).not.toContain(m.dc_deck_confirm);
    expect(screen.getByTestId('sign-body').contains(screen.getByTestId('sign-grants-box'))).toBe(true);
    // The rail's headings still carry their lines.
    expect(await screen.findByText('custom:payments')).toBeTruthy();
    expect(screen.getByTestId('sign-forecast').textContent).toContain('3 items held on this draft');
  });

  it('drops with the reason picked in the prompt', async () => {
    const { onDecide } = mount();
    await screen.findByTestId('sign-body');
    key('x');
    fireEvent.click(await screen.findByText(m.ml_sign_drop_fold));
    const submit = screen.queryByRole('button', { name: new RegExp(m.ml_sign_drop) });
    if (submit) fireEvent.click(submit);
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0]).toMatchObject({ verdict: 'reject', reason: 'Fold it into an existing mandate' });
  });
});

describe('re-read Sign card', () => {
  const reread: MandateReread = {
    code: 'dominant', asks: 5, acts: 12, spendPct: null, mergesSinceRead: 0,
    leadScope: 'idea.accept', leadAbsorbs: 4, keptAtActs: 6,
    suggest: { action: 'widen', scope: 'idea.accept' },
  };
  const signed = mandate({ envelope: { envelopeVersion: 2, decideScopes: ['report.read'] }, reread });
  const card = rereadToDecision(signed, reread, m, tx, 'Later');
  const mount = () => mountLane('sign', [card], [laneEntry('mandate-reread:c1', { lane: 'sign', clause: 'none', itemKind: 'mandate' })], {
    mandates: [signed],
    charters: [{ charterId: 'c1', projectId: 'p1', status: 'active', envelopeVersion: 2, held: 0 }],
  });

  it('is titled with the reason, says the suggestion and the keep marker, and keeps on A', async () => {
    const { onDecide } = mount();
    expect(card.id).toBe('mandate-reread:c1');
    expect(await screen.findByText(/Most of what Personas sends you is one kind of work: accept ideas \(4 of 5\)/)).toBeTruthy();
    expect(screen.getByTestId('sign-reread-suggest').textContent).toContain('let the steward accept ideas');
    expect(screen.getByTestId('sign-reread').textContent).toContain('You kept it at 6 acts');
    expect(screen.queryByText(m.ml_sign_drop)).toBeNull();
    expect(screen.getByTestId('sign-verb').textContent).toContain(m.ml_reread_keep);
    key('x');
    expect(screen.queryByRole('dialog', { name: m.ml_sign_drop_title })).toBeNull();
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    const v = onDecide.mock.calls[0]![0];
    expect(v.verdict).toBe('accept');
    expect(v.envelope).toBeUndefined();
    expect(v.item.payload?.reread).toBe('dominant');
  });

  it('opens its edit with the suggestion applied and then signs the change', async () => {
    const { onDecide } = mount();
    await screen.findByTestId('sign-reread');
    key('e');
    expect(screen.getByTestId('sign-scope-idea.accept').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('sign-verb').textContent).toContain(m.ml_reread_sign_change);
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0].envelope).toMatchObject({ decideScopes: ['idea.accept', 'report.read'] });
  });
});
