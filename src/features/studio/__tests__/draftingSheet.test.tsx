import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// The drafting sheet (contest A/3 in Personas): the model decides what is
// drawn, the sheet paints it from real Studio data.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => (k === 'guide' ? new Proxy({}, { get: (_, kk) => String(kk) }) : String(k)) }) }),
    tx: (s: string) => s,
  }),
}));

const { regionForGoal, regionWeights, proofFilter, sheetMoment, doneShare } = await import('../guide/drafting/draftingModel');
const GuideDraftingSheet = (await import('../guide/drafting/GuideDraftingSheet')).default;

const REGIONS = [
  { title: 'Top bar', purpose: 'brand and the way to order' },
  { title: 'Hero', purpose: 'what is fresh this morning' },
  { title: 'Menu grid', purpose: 'today, with prices' },
  { title: 'Footer', purpose: 'contact' },
];
const SKETCH = {
  summary: 'A bakery that takes pickup orders.',
  pages: [
    { title: 'Home', route: '/', regions: REGIONS },
    { title: 'Order', route: '/order', regions: [{ title: 'Basket', purpose: '' }] },
  ],
  goals: [{ title: 'Daily menu', note: '' }],
  questions: [],
};
const phase = (title: string, status: string) => ({ id: title, title, status, note: null });
type Props = Parameters<typeof GuideDraftingSheet>[0];
const base: Props = {
  name: 'Hearth',
  sketch: SKETCH,
  sketchState: 'ready',
  steps: [],
  startedAt: null,
  phases: [],
  placeholder: true,
  activity: [],
  working: false,
  notes: null,
  awaitingApproval: false,
  proofUrl: null,
};

afterEach(cleanup);

describe('the drafting model', () => {
  it('finds the region a goal is about by shared words, and nothing when there is none', () => {
    expect(regionForGoal('Daily menu', REGIONS)).toBe(2);
    expect(regionForGoal('Hero section', REGIONS)).toBe(1);
    expect(regionForGoal('Polish and launch', REGIONS)).toBe(-1);
  });

  it('draws bars thin and a hero tall', () => {
    expect(regionWeights(['Top bar', 'Hero', 'Menu grid', 'Footer'])).toEqual([1, 3, 2, 1]);
  });

  it('holds a deep proof while the plan is in work and develops into colour when it is done', () => {
    expect(proofFilter(0)).toContain('hue-rotate(178deg)');
    expect(proofFilter(0.5)).toContain('grayscale');
    expect(proofFilter(1)).toBe('none');
  });

  it('knows which drawing it is showing', () => {
    expect(sheetMoment(false, [], true)).toBe('template');
    expect(sheetMoment(true, [], true)).toBe('sketch');
    expect(sheetMoment(true, [phase('Vision', 'done') as never], false)).toBe('plan');
    expect(doneShare([phase('a', 'done'), phase('b', 'pending')] as never)).toBe(0.5);
  });
});

describe('the drafting sheet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('builds a new project up part by part across the setup wait', () => {
    render(<GuideDraftingSheet {...base} />);
    // The first region at once (named on the sheet and in the pen's callout), the rest one at a time.
    expect(screen.getAllByText('Top bar').length).toBeGreaterThan(0);
    expect(screen.queryByText('Menu grid')).toBeNull();
    wait(1600);
    expect(screen.getAllByText('Hero').length).toBeGreaterThan(0);
    expect(screen.queryByText('Menu grid')).toBeNull();
    // The brief is lettered in only after every page is drawn.
    expect(screen.queryByText('draft_brief')).toBeNull();
    wait(1500 * 6);
    expect(screen.getAllByText('Basket').length).toBeGreaterThan(0);
    expect(screen.getByText('draft_brief')).toBeTruthy();
    wait(1500 * 2);
    expect(screen.getAllByText('Daily menu').length).toBeGreaterThan(0);
  });

  it('before the sketch, draws the stock page and says the goals come with the brief', () => {
    render(<GuideDraftingSheet {...base} sketch={null} sketchState="loading" />);
    wait(1100 * 5);
    expect(screen.getByText('template_region_banner')).toBeTruthy();
    expect(screen.getByText('draft_goals_empty')).toBeTruthy();
    expect(screen.getByText('draft_status_template')).toBeTruthy();
  });

  it('while she works, the region of the goal in work is drafting and done goals ink their regions', () => {
    render(
      <GuideDraftingSheet
        {...base}
        opened
        placeholder={false}
        working
        phases={[phase('Hero', 'done'), phase('Daily menu', 'active'), phase('Polish', 'pending')] as never}
      />,
    );
    wait(3000);
    const menu = screen.getByText('Menu grid').closest('div')!.parentElement!;
    expect(menu.textContent).toContain('draft_state_drafting');
    // (The first "Hero" is the region on sheet 1; the goal list comes after.)
    const hero = screen.getAllByText('Hero')[0]!.closest('div')!.parentElement!;
    expect(hero.textContent).toContain('draft_state_done');
    expect(screen.getByText('draft_status_plan')).toBeTruthy();
  });

  it('stamps the sheet for approval, and as issued when every goal is done', () => {
    const { rerender } = render(<GuideDraftingSheet {...base} placeholder={false} phases={[phase('Hero', 'active')] as never} awaitingApproval />);
    expect(screen.getAllByText('draft_stamp_approval').length).toBeGreaterThan(0);
    rerender(<GuideDraftingSheet {...base} placeholder={false} phases={[phase('Hero', 'done')] as never} />);
    expect(screen.getAllByText('draft_stamp_issued').length).toBeGreaterThan(0);
  });
});

describe('a reopened project never draws a part it has nothing for', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const PLAN = [phase('Vision', 'done'), phase('Menu', 'active'), phase('Order ahead', 'pending')].map((p, i) =>
    i === 0 ? { ...p, id: 'vision', note: 'storefront + order ahead' } : p,
  );

  it('with a plan but no sketch, the drawing is the plan itself, not a made-up stock page', () => {
    render(<GuideDraftingSheet {...base} opened sketch={null} sketchState={null} placeholder={false} phases={PLAN as never} />);
    wait(2000);
    expect(screen.getByTestId('drafting-sheet').dataset.drawing).toBe('plan');
    expect(screen.getByText('draft_plan_sheet')).toBeTruthy();
    expect(screen.getByText('Order ahead')).toBeTruthy();
    expect(screen.queryByText('template_region_banner')).toBeNull();
    // The goals are the drawing; the title block does not repeat them.
    expect(screen.queryByText('draft_goals')).toBeNull();
    // The brief falls back to the vision goal's note (also that goal's frame note).
    expect(screen.getByText('draft_brief').parentElement!.textContent).toContain('storefront + order ahead');
  });

  it('before its plan loads, ghost frames without labels, and no empty cells', () => {
    render(<GuideDraftingSheet {...base} opened sketch={null} sketchState={null} />);
    expect(screen.getByTestId('drafting-sheet').dataset.drawing).toBe('skeleton');
    expect(screen.queryByText('template_region_nav')).toBeNull();
    expect(screen.getByText('draft_status_loading')).toBeTruthy();
    for (const cell of ['draft_brief', 'draft_goals', 'draft_notes']) expect(screen.queryByText(cell)).toBeNull();
    // No ghost second sheet either: that one is for a project being created.
    expect(screen.queryByText('template_hint')).toBeNull();
  });

  it('pages without regions are left out', () => {
    const sketch = { ...SKETCH, pages: [...SKETCH.pages, { title: 'Blog', route: '/blog', regions: [] }] };
    render(<GuideDraftingSheet {...base} opened sketch={sketch} />);
    wait(3000);
    expect(screen.queryByText('Blog')).toBeNull();
    expect(screen.getByText('Order')).toBeTruthy();
  });
});
