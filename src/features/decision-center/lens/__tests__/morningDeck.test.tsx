/**
 * The Monitor's Morning tab (lens/morning/MorningDeck.tsx, spark roadmap S6 G6) over a fake source (no IPC, no bp), on a
 * deck shaped like bp's demo morning:
 *  - the cards in bp's order, each decision card with its brief; a repeat shows its chip and offers Decline first;
 *  - Approve goes through Personas' own decide with the project found by root, then the deck is read again and the card
 *    bp dropped is gone;
 *  - Decline only on a repeat, with the brief's note; Enter takes the recommended answer (owner decision D14);
 *  - a product Personas has not got cannot be decided ("Not in Personas"); bp down says so with a retry;
 *  - the tab is a Blueprint surface: it says hello to bp while the Monitor shows it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import { MorningDeck, type MorningSource } from '../morning/MorningDeck';
import { BpFollower } from '../bpFollower';
import type { FollowSource } from '../../blueprint/source';

const NOTE = 'Repeats kf-051, declined 2026-10-08: "Not while the CDN still strips them; ask again after the edge move."';
const card = (id: string, extra: Record<string, unknown>) => ({ id, kind: 'decision', product: 'kettle-web', productName: 'Kettle Web', headline: `Decide ${id}`, lines: [], tone: 'warn', ...extra });
const DECK = {
  since: '2026-10-30T15:00:00.000Z', until: '2026-10-31T07:00:00.000Z', products: [], news: { since: '2026-10-31T07:00:00.000Z', count: 0 },
  cards: [
    { id: 'open', kind: 'open', headline: 'Overnight: 3 items built, 2 decisions waiting.', lines: [{ text: 'Kettle Web: 2 built' }], tone: 'calm' },
    card('decision:kettle-web:kf-010', { place: { product: 'kettle-web', target: { kind: 'feature', id: 'cdn-cache' }, level: 'L4' }, decision: { proposal: 'kf-010', tier: 1, brief: { facts: [], lines: ['Repeats kf-051'], advice: { say: 'withdraw' }, recommend: 'decline', note: NOTE, short: 'Repeats your decline kf-051 (2026-10-08 by owner)' } } }),
    card('decision:kettle-web:kf-020', { decision: { proposal: 'kf-020', tier: 2, brief: { facts: [], lines: ['No decline like it'], advice: { say: 'proceed' }, short: 'No decline like it' } } }),
    card('decision:atlas:at-1', { product: 'atlas', productName: 'Atlas', decision: { proposal: 'at-1', brief: { facts: [], lines: [], advice: { say: 'proceed' }, short: 'Fine' } } }),
  ],
};

function fakeFollower() {
  const moves: string[] = [];
  const src: FollowSource = {
    reader: 'personas:main',
    read: async () => ({ online: true, view: { rev: 0, shared: null, readers: [] } }),
    move: async (op) => { moves.push(op); return {}; },
    products: async () => [{ slug: 'kettle-web', name: 'Kettle Web', root: 'C:/demo/kettle-web', projectId: 'p-kettle' }, { slug: 'atlas', name: 'Atlas', root: 'C:/demo/atlas' }],
  };
  return { follower: new BpFollower(src, { open: vi.fn() }), moves };
}

function fakeSource(online = true) {
  let deck: typeof DECK = structuredClone(DECK);
  const source: MorningSource & { decide: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> } = {
    read: vi.fn(async () => (online ? { base: 'http://127.0.0.1:4320', online: true, deck, error: null } : { base: 'http://127.0.0.1:4320', online: false, deck: undefined, error: 'not running' })),
    decide: vi.fn(async (_p: string, ids: string[], decision: 'approve' | 'decline') => {
      // the store moved: bp's next read no longer carries the card
      deck = { ...deck, cards: deck.cards.filter((c) => !('decision' in c) || (c.decision as { proposal: string }).proposal !== ids[0]) };
      return { decision: decision === 'approve' ? 'approved' : 'declined', by: 'user:personas', decided: ids, skipped: [] };
    }),
    open: vi.fn(),
    openExternal: vi.fn(async () => undefined),
  };
  return source;
}

function mount(source = fakeSource()) {
  useSystemStore.setState({ headerOverlay: 'monitor' } as never);
  const f = fakeFollower();
  render(<MorningDeck source={source} follower={f.follower} />);
  return { source, ...f };
}
const row = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`);
const key = (k: string) => act(() => { fireEvent.keyDown(screen.getByTestId('monitor-morning'), { key: k }); });

afterEach(() => { vi.clearAllMocks(); });

describe('the Morning tab', () => {
  it('shows bp\'s cards in order, a repeat with its chip and Decline first, and says hello to bp', async () => {
    const { moves } = mount();
    await waitFor(() => expect(row('decision:kettle-web:kf-010')).toBeTruthy());
    expect(Array.from(document.querySelectorAll('[data-card]')).map((e) => e.getAttribute('data-kind'))).toEqual(['open', 'decision', 'decision', 'decision']);
    const rep = row('decision:kettle-web:kf-010')!;
    expect(within(rep).getByTestId('morning-brief-decision:kettle-web:kf-010').textContent).toContain('Repeats your decline kf-051');
    const acts = Array.from(rep.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'));
    expect(acts.slice(0, 2)).toEqual(['morning-decline-decision:kettle-web:kf-010', 'morning-approve-decision:kettle-web:kf-010']);
    expect(row('decision:kettle-web:kf-020')!.querySelector('[data-testid^="morning-decline"]')).toBeNull();
    expect(moves).toContain('hello');
  });

  it('Approve decides through Personas with the project found by root, and the re-read drops the card', async () => {
    const { source } = mount();
    await waitFor(() => expect(screen.getByTestId('morning-approve-decision:kettle-web:kf-020')).not.toHaveProperty('disabled', true));
    act(() => { fireEvent.click(screen.getByTestId('morning-approve-decision:kettle-web:kf-020')); });
    await waitFor(() => expect(source.decide).toHaveBeenCalledWith('p-kettle', ['kf-020'], 'approve', undefined));
    await waitFor(() => expect(row('decision:kettle-web:kf-020')).toBeNull());
    expect(screen.getByTestId('morning-said').textContent).toContain('Approved kf-020');
  });

  it('Decline on a repeat writes the brief\'s note', async () => {
    const { source } = mount();
    await waitFor(() => expect(screen.getByTestId('morning-decline-decision:kettle-web:kf-010')).not.toHaveProperty('disabled', true));
    act(() => { fireEvent.click(screen.getByTestId('morning-decline-decision:kettle-web:kf-010')); });
    await waitFor(() => expect(source.decide).toHaveBeenCalledWith('p-kettle', ['kf-010'], 'decline', NOTE));
  });

  it('Enter takes the recommended answer (D14): Decline on the repeat, Approve otherwise; X does nothing off a repeat', async () => {
    const { source } = mount();
    await waitFor(() => expect(screen.getByTestId('morning-approve-decision:kettle-web:kf-020')).not.toHaveProperty('disabled', true));
    key('j'); // the repeat
    key('Enter');
    await waitFor(() => expect(source.decide).toHaveBeenLastCalledWith('p-kettle', ['kf-010'], 'decline', NOTE));
    await waitFor(() => expect(row('decision:kettle-web:kf-010')).toBeNull());
    // the cursor now rests on kf-020 (a plain decision)
    key('x');
    key('Enter');
    await waitFor(() => expect(source.decide).toHaveBeenLastCalledWith('p-kettle', ['kf-020'], 'approve', undefined));
    expect(source.decide).toHaveBeenCalledTimes(2);
  });

  it('a product Personas has not got cannot be decided, and says so', async () => {
    const { source } = mount();
    await waitFor(() => expect(row('decision:atlas:at-1')!.textContent).toContain('Not in Personas: atlas'));
    expect(screen.getByTestId<HTMLButtonElement>('morning-approve-decision:atlas:at-1').disabled).toBe(true);
    expect(source.decide).not.toHaveBeenCalled();
  });

  it('Open takes the card\'s place to the product\'s drawing', async () => {
    const { source } = mount();
    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('morning-open-decision:kettle-web:kf-010').disabled).toBe(false));
    act(() => { fireEvent.click(screen.getByTestId('morning-open-decision:kettle-web:kf-010')); });
    expect(source.open).toHaveBeenCalledWith('p-kettle', { product: 'kettle-web', target: { kind: 'feature', id: 'cdn-cache' }, level: 'L4' });
  });

  it('bp down says so, with a retry', async () => {
    mount(fakeSource(false));
    await waitFor(() => expect(screen.getByText(/bp is not answering/)).toBeTruthy());
  });
});
