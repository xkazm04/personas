/**
 * The decision brief on a waiting card (spark roadmap S3), mounted on the Kettle fixture:
 *  - the repeat (fixture/briefDemo.ts: kf-010 filed again after kf-051 was declined on the same feature and lens):
 *    the brief says withdraw, Decline is the first answer, Approve stays as "approve anyway", X opens the reason
 *    pre-filled with the note naming the decision it repeats, and Enter sends exactly that note through
 *    actions.decide (the same seam lens_scan_decide sits behind);
 *  - the ask (Kettle's own kf-001, whose standard was declined on another feature): the decline shows in amber with
 *    its chip, Approve stays first, and X opens an empty reason;
 *  - a fact with evidence opens it; Y stays triage accept (the brief binds no key).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { BRIEF_ASK, BRIEF_REPEAT, withBriefDemo } from '../fixture/briefDemo';
import { actOf } from '../model/keymap';
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

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const featureOf = (data: BlueprintData, id: string) => data.scan.proposals.find((p) => p.id === id)!.feature;
const card = (id: string) => document.querySelector<HTMLElement>(`article[data-item="${id}"]`)!;
const optionIds = (id: string) => Array.from(card(id).querySelectorAll('[data-testid^="blueprint-"]')).map((e) => e.getAttribute('data-testid')).filter((t) => t === 'blueprint-approve' || t === 'blueprint-decline');

let data: BlueprintData;
let actions: ReturnType<typeof createFixtureActions>;

function mount(feature: string) {
  return render(<AppKeyboardProvider><BlueprintSheet data={data} actions={actions} onClose={() => {}} initialFeature={feature} /></AppKeyboardProvider>);
}

afterEach(() => { vi.clearAllMocks(); });

describe('the brief on a repeat of a declined idea', () => {
  beforeEach(() => { data = withBriefDemo(kettleData()); actions = createFixtureActions(data); });

  it('says withdraw, makes Decline the first answer and keeps Approve as approve anyway', async () => {
    mount(featureOf(data, BRIEF_REPEAT.open));
    await waitFor(() => expect(card(BRIEF_REPEAT.open)).toBeTruthy());
    const brief = within(card(BRIEF_REPEAT.open)).getByTestId('blueprint-brief');
    expect(brief.getAttribute('data-advice')).toBe('withdraw');
    const declined = brief.querySelector('[data-fact="declined"]')!;
    expect(declined.textContent).toContain(BRIEF_REPEAT.declined);
    expect(declined.textContent).toContain(BRIEF_REPEAT.note);
    // v4: the tier reaches the precedent line and the risk class the undo line
    expect(brief.querySelector('[data-fact="precedent"]')!.textContent).toContain('tier 1');
    expect(brief.querySelector('[data-fact="undo"]')!.textContent).toContain('authz risk');
    expect(optionIds(BRIEF_REPEAT.open)).toEqual(['blueprint-decline', 'blueprint-approve']);
    expect(within(card(BRIEF_REPEAT.open)).getByTestId('blueprint-decline').className).toContain('bp-ap');
    expect(within(card(BRIEF_REPEAT.open)).getByTestId('blueprint-approve').className).not.toContain('bp-ap');
  });

  it('X opens the reason pre-filled with the repeat note, and Enter declines with exactly that note', async () => {
    const decide = vi.spyOn(actions, 'decide');
    mount(featureOf(data, BRIEF_REPEAT.open));
    await waitFor(() => expect(card(BRIEF_REPEAT.open)).toBeTruthy());
    act(() => { fireEvent.click(within(card(BRIEF_REPEAT.open)).getByTestId('blueprint-decline')); });
    const input = await screen.findByTestId<HTMLInputElement>('blueprint-reason-input');
    const note = `Repeats ${BRIEF_REPEAT.declined}, declined 2026-10-08: "${BRIEF_REPEAT.note}"`;
    expect(input.value).toBe(note);
    expect(screen.getByTestId('blueprint-reason-preview').textContent).toContain(JSON.stringify(note));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(decide).toHaveBeenCalledWith([BRIEF_REPEAT.open], 'decline', note));
    const row = (await actions.refresh()).scan.proposals.find((p) => p.id === BRIEF_REPEAT.open)!;
    expect(row.status).toBe('declined');
    expect(row.decision_note).toBe(note);
  });
});

describe('the brief on a like idea declined elsewhere', () => {
  beforeEach(() => { data = kettleData(); actions = createFixtureActions(data); });

  it('asks: the decline in amber with its chip, Approve stays first, and X opens an empty reason', async () => {
    mount(featureOf(data, BRIEF_ASK.open));
    await waitFor(() => expect(card(BRIEF_ASK.open)).toBeTruthy());
    const brief = within(card(BRIEF_ASK.open)).getByTestId('blueprint-brief');
    expect(brief.getAttribute('data-advice')).toBe('ask');
    expect(brief.querySelector('.bp-bf-adv')).toBeTruthy();
    expect(brief.querySelector('[data-fact="declined"]')!.textContent).toContain(`same standard, ${BRIEF_ASK.declined}`);
    expect(optionIds(BRIEF_ASK.open)).toEqual(['blueprint-approve', 'blueprint-decline']);
    expect(within(card(BRIEF_ASK.open)).getByTestId('blueprint-approve').className).toContain('bp-ap');
    key('x');
    const input = await screen.findByTestId<HTMLInputElement>('blueprint-reason-input');
    expect(input.value).toBe('');
  });

  it('a fact with evidence opens its list: the declined row with the owner\'s own note', async () => {
    mount(featureOf(data, BRIEF_ASK.open));
    await waitFor(() => expect(card(BRIEF_ASK.open)).toBeTruthy());
    const fact = card(BRIEF_ASK.open).querySelector<HTMLElement>('[data-fact="declined"]')!;
    const open = fact.querySelector<HTMLButtonElement>('button')!;
    expect(open.getAttribute('aria-expanded')).toBe('false');
    act(() => { fireEvent.click(open); });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(fact.querySelector('q')!.textContent).toBe('Not before the release.');
  });

  it('binds no key: Y is still triage accept, A approve and X decline', () => {
    expect([actOf('y'), actOf('a'), actOf('x')]).toEqual(['accept', 'approve', 'decline']);
  });
});
