import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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
  it('before the sketch, draws the stock page and says the goals come with the brief', () => {
    render(<GuideDraftingSheet {...base} sketch={null} sketchState="loading" />);
    expect(screen.getByText('template_region_banner')).toBeTruthy();
    expect(screen.getByText('draft_goals_empty')).toBeTruthy();
    expect(screen.getByText('draft_status_template')).toBeTruthy();
  });

  it('draws the sketch as numbered sheets with the brief and the sketched goals', () => {
    render(<GuideDraftingSheet {...base} />);
    expect(screen.getByText('Menu grid')).toBeTruthy();
    expect(screen.getByText('Basket')).toBeTruthy();
    expect(screen.getByText('A bakery that takes pickup orders.')).toBeTruthy();
    expect(screen.getByText('Daily menu')).toBeTruthy();
  });

  it('while she works, the region of the goal in work is drafting and done goals ink their regions', () => {
    render(
      <GuideDraftingSheet
        {...base}
        placeholder={false}
        working
        phases={[phase('Hero', 'done'), phase('Daily menu', 'active'), phase('Polish', 'pending')] as never}
      />,
    );
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
