/**
 * One count, everywhere (lot B, direction 4), on the Kettle fixture mounted as a whole sheet:
 *  - the header summary, the Plan panel's strip, the queue's product line and the ledger switch all print the figures
 *    `model/counts.ts` computes for the same features: one number per label;
 *  - "in trouble" is bad; watch is its own figure; live counts a flagged feature inside it;
 *  - a proposal whose feature is not on the plan is counted off the plan, named under the product strip, and its press
 *    opens the ledger;
 *  - the key line's ? opens the key sheet, and its keys come from the keymap.
 * Same canvas stubs as chrome.test.tsx.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { figures, offPlanWaiting, openFindings, waitingOf } from '../model/counts';
import { buildPlan } from '../model/plan';
import { buildWork } from '../model/work';

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

/** The fixture plus two waiting proposals and one declined, all on a feature the map does not have. */
function withOffPlan() {
  const d = kettleData(), base = d.scan.proposals[0]!;
  d.scan = {
    ...d.scan,
    proposals: [...d.scan.proposals,
      { ...base, id: 'ghost-1', feature: 'no-such-feature', status: 'proposed' },
      { ...base, id: 'ghost-2', feature: 'no-such-feature', status: 'proposed' },
      { ...base, id: 'ghost-3', feature: 'no-such-feature', status: 'declined' }],
  };
  return d;
}

function mount(d = withOffPlan()) {
  return render(<AppKeyboardProvider><BlueprintSheet data={d} actions={createFixtureActions(d)} onClose={vi.fn()} /></AppKeyboardProvider>);
}
const rail = (k: string) => screen.getByTestId('blueprint-rail').querySelector<HTMLButtonElement>(`[data-k="${k}"]`)!;
const num = (re: RegExp, text: string) => Number(re.exec(text)?.[1] ?? NaN);

describe('counts.ts', () => {
  const d = withOffPlan(), plan = buildPlan(d.structure, d.events), work = buildWork(plan.L, d.scan);

  it('keeps off-plan proposals instead of dropping them, and counts only the waiting ones', () => {
    expect(work.offPlan).toHaveLength(3);
    expect(offPlanWaiting(work)).toBe(2);
    expect(work.items.every((p) => p.fid !== 'no-such-feature')).toBe(true);
    expect(openFindings(work)).toBe(waitingOf(work.items) + 2);
  });

  it('counts bad apart from watch, and a flagged feature inside live', () => {
    const f = figures(plan.S.features);
    expect(f.bad).toBe(plan.S.features.filter((x) => x.health === 'bad').length);
    expect(f.watch).toBe(plan.S.features.filter((x) => x.health === 'watch').length);
    expect(f.live).toBe(plan.S.features.filter((x) => x.stage === 'live' || x.stage === 'flagged').length);
    expect(f.bad).toBeGreaterThan(0);
    expect(f.watch).toBeGreaterThan(0);
  });
});

describe('every surface reads the same figures', () => {
  const d = withOffPlan(), plan = buildPlan(d.structure, d.events), work = buildWork(plan.L, d.scan), fg = figures(plan.S.features);

  it('header, Plan panel, queue line and ledger switch agree for one fixture', async () => {
    mount(d);
    const sum = screen.getByTestId('blueprint-sum').textContent ?? '';
    expect(num(/(\d+) live/, sum)).toBe(fg.live);
    expect(num(/(\d+) in trouble/, sum)).toBe(fg.bad);
    // the queue's product line says "live", with the header's number
    const line = document.querySelector('.bp-ps')!.textContent ?? '';
    expect(num(/live (\d+)/, line)).toBe(fg.live);
    expect(line).not.toMatch(/built/i);
    // the ledger switch counts what the ledger lists: on-plan and off-plan waiting
    expect(screen.getByTestId('blueprint-page-ledger').textContent).toContain(String(openFindings(work)));
    // the Plan panel's strip: bad as "in trouble", watch as its own figure
    fireEvent.click(rail('plan'));
    const flyout = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-testid="blueprint-flyout"]'); expect(el).toBeTruthy(); return el!; });
    const strip = [...flyout.querySelectorAll('.wb-strip .wb-count')].map((c) => [c.querySelector('b')!.textContent, c.querySelector('span')!.textContent]);
    expect(strip).toContainEqual([String(fg.bad), 'in trouble']);
    expect(strip).toContainEqual([String(fg.watch), 'to watch']);
  });

  it('names the off-plan waiting under the product strip, and its press opens the ledger', () => {
    mount(d);
    const note = screen.getByTestId('blueprint-offplan');
    expect(note.textContent).toBe('2 waiting off the plan');
    expect(screen.getByTestId('blueprint-page-ledger').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(note);
    expect(screen.getByTestId('blueprint-page-ledger').getAttribute('aria-pressed')).toBe('true');
  });

  it('says nothing about the plan when nothing is off it', () => {
    mount(kettleData());
    expect(screen.queryByTestId('blueprint-offplan')).toBeNull();
  });
});

describe('the key line', () => {
  it('shows ledger, timeline and select beside the old keys, and the ? opens the key sheet', async () => {
    mount();
    const foot = document.querySelector('.bp-ft')!;
    const caps = [...foot.querySelectorAll('.bp-kbd')].map((k) => k.textContent);
    for (const k of ['L', 'T', 'Space', '?']) expect(caps).toContain(k);
    expect(document.querySelector('.bp-keys')).toBeNull();
    fireEvent.click(screen.getByTestId('blueprint-help-key'));
    await waitFor(() => expect(document.querySelector('.bp-keys')).toBeTruthy());
  });
});
