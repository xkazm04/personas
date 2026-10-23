/**
 * The Breach card's head and mandate state, through the real deck
 * (mandate-lanes WP5P):
 *  - the head carries one "If you <verb>" line per numbered verdict in the
 *    dock, in the dock's order, never the generic accept / reject pair;
 *  - an unsigned mandate is named in "Why it reached you", and the card says
 *    what signing would change;
 *  - with no mandate the card says the project has none and points at the
 *    Orphans lane, prints no Suspend, and the head has two lines.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { en } from '@/i18n/en';
import { useSystemStore } from '@/stores/systemStore';
import { item } from '../../__tests__/rosterFixtures';
import type { MonitorCopy } from '../deckMeta';
import { laneEntry, mandate } from '../../mandate/__tests__/mandateFixtures';
import { useDecisionDeckStore } from '../deckStore';
import { mountLane } from './shapeKit';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor as MonitorCopy;
const tx = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

afterEach(() => useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null }));

const idea = item({ id: 'idea:1', kind: 'idea', title: 'Cache the board', verdictLabels: { accept: 'Accept', reject: 'Reject', skip: 'Later' } });
const ifYou = (verb: string) => tx(m.dc_deck_if_you, { verb });
const bands = () => screen.getByTestId('deck-outcomes').querySelectorAll('p');

describe('Breach head', () => {
  it('a scope breach on a signed mandate reads widen, deny, suspend in dock order', async () => {
    mountLane('breach', [idea], [laneEntry('idea:1', { clause: 'scope' })], { mandates: [mandate()] });
    await screen.findByTestId('breach-body');
    const lines = [...bands()].map((b) => b.getAttribute('data-verb'));
    expect(lines).toEqual([m.ml_breach_out_widen_verb, m.ml_breach_out_deny_verb, m.ml_breach_out_suspend_verb]);
    expect(screen.getByTestId('deck-outcomes').textContent).toContain(ifYou(m.ml_breach_out_widen_verb));
    expect(screen.getByTestId('deck-outcomes').textContent).not.toContain(ifYou('reject'));
    // A signed mandate needs no state line.
    expect(screen.queryByTestId('breach-mandate-state')).toBeNull();
  });

  it('an unsigned mandate is named as the reason, with what signing would change', async () => {
    const unsigned = mandate({ envelope: { envelopeVersion: 0 } });
    mountLane('breach', [idea], [laneEntry('idea:1', { clause: 'unsigned' })], { mandates: [unsigned] });
    await screen.findByTestId('breach-body');
    expect(screen.getByTestId('breach-clause').textContent).toContain(tx(m.ml_breach_state_unsigned, { project: 'Personas' }));
    expect(screen.queryByTestId('breach-mandate-state')).toBeNull();
    // Unsigned but active: it can still be suspended, so the head has three lines.
    expect(bands()).toHaveLength(3);
    expect(bands()[0]!.getAttribute('data-verb')).toBe('accept');
  });

  it('no mandate: the project is named, the Orphans lane is the way, and there is no Suspend', async () => {
    useSystemStore.setState({ projects: [{ id: 'p9', name: 'Ascent' }] as never });
    mountLane('breach', [idea], [laneEntry('idea:1', { clause: 'none', charterId: null, projectId: 'p9' })]);
    await screen.findByTestId('breach-body');
    const state = screen.getByTestId('breach-mandate-state');
    expect(state.getAttribute('data-state')).toBe('none');
    expect(state.textContent).toContain(tx(m.ml_breach_state_none, { project: 'Ascent' }));
    expect(screen.queryByText(m.ml_suspend)).toBeNull();
    expect(screen.getByText(m.ml_breach_amend_item_hint_none)).toBeTruthy();
    expect([...bands()].map((b) => b.getAttribute('data-verb'))).toEqual(['accept', m.ml_breach_out_deny_verb]);
    useSystemStore.setState({ projects: [] });
  });
});
