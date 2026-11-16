/**
 * Owner decision D14 (bp roadmap S6, 2026-10-31): "Personas will take the recommended answer". On a waiting item's L4
 * sheet, Enter takes the card's first answer through actions.decide (the seam lens_scan_decide sits behind):
 *  - a repeat of a declined idea (the brief says withdraw): Decline, with the note naming the decision it repeats,
 *    exactly what bp's deck writes on Enter;
 *  - anything else (here the ask, a like idea declined elsewhere): Approve, the card's primary;
 *  - an item with no decision left (approved): Enter takes nothing and says the keys.
 * The primary band shows Enter beside its own key.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { BRIEF_ASK, BRIEF_REPEAT, withBriefDemo } from '../fixture/briefDemo';
import type { BlueprintData } from '../source';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

beforeAll(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createPattern: () => ({ setTransform() {} }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});
afterEach(() => { vi.clearAllMocks(); });

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const card = (id: string) => document.querySelector<HTMLElement>(`article[data-item="${id}"]`);
const featureOf = (data: BlueprintData, id: string) => data.scan.proposals.find((p) => p.id === id)!.feature;
const say = () => document.querySelector('.bp-say')?.textContent ?? '';

/** The sheet open at the item's feature with that item current (j steps the queue until it wears the focus ring). */
async function openAt(data: BlueprintData, id: string) {
  const actions = createFixtureActions(data);
  const decide = vi.spyOn(actions, 'decide');
  render(<AppKeyboardProvider><BlueprintSheet data={data} actions={actions} onClose={() => {}} initialFeature={featureOf(data, id)} /></AppKeyboardProvider>);
  await waitFor(() => expect(card(id)).toBeTruthy());
  for (let i = 0; i < 40 && card(id)!.getAttribute('aria-current') !== 'true'; i++) key('j');
  expect(card(id)!.getAttribute('aria-current')).toBe('true');
  return { actions, decide };
}

describe('Enter takes the recommended answer (D14)', () => {
  it('on a repeat: Decline, with the note naming the decision it repeats', async () => {
    const data = withBriefDemo(kettleData());
    const { actions, decide } = await openAt(data, BRIEF_REPEAT.open);
    const decline = within(card(BRIEF_REPEAT.open)!).getByTestId('blueprint-decline');
    expect(decline.textContent).toContain('Enter');
    expect(within(card(BRIEF_REPEAT.open)!).getByTestId('blueprint-approve').textContent).not.toContain('Enter');
    key('Enter');
    const note = `Repeats ${BRIEF_REPEAT.declined}, declined 2026-10-08: "${BRIEF_REPEAT.note}"`;
    await waitFor(() => expect(decide).toHaveBeenCalledWith([BRIEF_REPEAT.open], 'decline', note));
    expect(decide).toHaveBeenCalledTimes(1);
    const row = (await actions.refresh()).scan.proposals.find((p) => p.id === BRIEF_REPEAT.open)!;
    expect([row.status, row.decision_note]).toEqual(['declined', note]);
  });

  it('otherwise: Approve, the card\'s primary (the ask keeps Approve first)', async () => {
    const data = kettleData();
    const { actions, decide } = await openAt(data, BRIEF_ASK.open);
    expect(within(card(BRIEF_ASK.open)!).getByTestId('blueprint-approve').textContent).toContain('Enter');
    key('Enter');
    await waitFor(() => expect(decide).toHaveBeenCalledWith([BRIEF_ASK.open], 'approve', undefined));
    expect(decide).toHaveBeenCalledTimes(1);
    expect((await actions.refresh()).scan.proposals.find((p) => p.id === BRIEF_ASK.open)!.status).toBe('approved');
  });

  it('an item with nothing left to decide: Enter takes nothing and says the keys', async () => {
    const data = kettleData();
    const { decide } = await openAt(data, BRIEF_ASK.open);
    key('Enter');
    await waitFor(() => expect(card(BRIEF_ASK.open)!.getAttribute('data-status')).toBe('approved'));
    key('Enter');
    await waitFor(() => expect(say()).toContain('A approves, X declines this item.'));
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
