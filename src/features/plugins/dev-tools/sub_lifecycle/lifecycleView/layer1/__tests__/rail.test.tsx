import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { mixWithEvidence } from '../../../journey/__tests__/detailFixtures';
import { healthyMix, soloV0 } from '../../../journey/__tests__/fixtures';
import { Layer1 } from '../Layer1';
import { PEEK_DELAY_MS } from '../rail/usePeek';
import { renderLayer1 } from './renderLayer1';

// The idle drain of the Layer-2 chunks is the prefetch tests' subject; here it
// would only outlive the test environment.
vi.mock('../../layer2/stepChunks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer2/stepChunks')>()),
  prefetchStepChunksOnIdle: () => () => {},
}));

const SIX = ['green', 'amber', 'red', 'unmeasured', 'instructed', 'stale'];
const ROWS = ['head', 'figure', 'meter', 'label', 'verdict'];

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`)!;

afterEach(() => { vi.useRealTimers(); });

describe('Layer-1 rail', () => {
  it('draws all six verdicts, each on its own card, in two lanes', () => {
    renderLayer1(<Layer1 />, healthyMix());
    const nodes = screen.getAllByTestId(/^lc-node-/);
    expect(nodes).toHaveLength(10);
    expect(new Set(nodes.map((n) => n.getAttribute('data-health')))).toEqual(new Set(SIX));
    expect(screen.getByTestId('lc-node-sync').getAttribute('data-health')).toBe('unmeasured');
    expect(screen.getByTestId('lc-node-commit').getAttribute('data-health')).toBe('stale');
    expect(screen.getByTestId('lc-node-frame').getAttribute('data-health')).toBe('instructed');
    expect(screen.getByTestId('lc-lane-before').querySelectorAll('[data-card]')).toHaveLength(4);
    expect(screen.getByTestId('lc-lane-after').querySelectorAll('[data-card]')).toHaveLength(6);
  });

  it('builds every card from the same five rows, whatever its verdict, so a lane is level', () => {
    renderLayer1(<Layer1 />, healthyMix());
    for (const c of document.querySelectorAll<HTMLElement>('[data-card]')) {
      const rows = [...c.querySelectorAll('[data-row]')].map((r) => r.getAttribute('data-row'));
      expect(rows, c.getAttribute('data-card')!).toEqual(ROWS);
    }
    // An instructed card fills the figure slot with the rule, at the same place.
    expect(card('frame').querySelector('[data-row="figure"]')!.textContent).toContain('By instruction');
  });

  it('renders a null figure as N/A, never as 0', () => {
    renderLayer1(<Layer1 />, healthyMix());
    expect(card('sync').querySelector('[data-na="true"]')?.textContent).toBe('N/A');
    expect(card('sync').textContent).not.toMatch(/(^|\D)0\s?%/);
    expect(card('land').querySelector('[data-figure]')!.textContent).toBe('40%');
  });

  it('marks each change since the earlier measure, toned by what the metric means', () => {
    renderLayer1(<Layer1 />, healthyMix());
    const mark = (id: string) => card(id).querySelector('[data-row="figure"] [data-delta]');
    expect(mark('isolate')?.getAttribute('data-tone')).toBe('good');
    expect(mark('isolate')?.textContent).toContain('+6');
    expect(mark('land')?.getAttribute('data-delta')).toBe('down');
    expect(mark('land')?.getAttribute('data-tone')).toBe('bad');
    // No earlier measure, or no move: no mark at all.
    expect(mark('sync')).toBeNull();
    expect(mark('docs')).toBeNull();
    expect(mark('record')).toBeNull();
    // A changed verdict says what it was.
    expect(screen.getByTestId('lc1-verdict-land').textContent).toContain('was At risk');
    expect(screen.getByTestId('lc1-verdict-isolate').textContent).not.toContain('was');
  });

  it('pipes the lane and breaks the pipe after a failing step', () => {
    renderLayer1(<Layer1 />, healthyMix());
    const pipe = (id: string) => card(id).querySelector('[data-pipe]')?.getAttribute('data-pipe');
    expect(pipe('frame')).toBeUndefined(); // a lane's first card has nothing flowing in
    expect(pipe('gate')).toBeUndefined();
    expect(pipe('land')).toBe('flow');
    expect(pipe('record')).toBe('broken'); // land is failing
  });

  it('opens a step on click and walks the journey with the arrow keys', () => {
    const { openStep } = renderLayer1(<Layer1 />, healthyMix());
    fireEvent.click(screen.getByTestId('lc-node-gate'));
    expect(openStep).toHaveBeenCalledWith('gate');
    expect(screen.getByTestId('lc-node-gate').getAttribute('aria-pressed')).toBe('true');
    expect(card('gate').getAttribute('data-selected')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('lc-journey-track'), { key: 'ArrowRight' });
    expect(screen.getByTestId('lc-node-tests').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('lc-node-tests').getAttribute('tabindex')).toBe('0');
  });

  it('reads well with no health at all: every step unmeasured or instructed, no goal', () => {
    renderLayer1(<Layer1 />, soloV0());
    const verdicts = new Set(screen.getAllByTestId(/^lc-node-/).map((n) => n.getAttribute('data-health')));
    expect(verdicts).toEqual(new Set(['unmeasured', 'instructed']));
    expect(screen.queryByTestId('lc1-goal')).toBeNull();
    expect(document.querySelectorAll('[data-na="true"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-delta]')).toHaveLength(0);
  });
});

describe('Layer-1 status band', () => {
  it('draws the goal as one bar grouped by verdict, and says it in words', () => {
    renderLayer1(<Layer1 />, healthyMix());
    const goal = screen.getByTestId('lc1-goal');
    expect(goal.textContent).toContain('3 of 8 measurable steps green, 2 instructed');
    const segments = [...screen.getByTestId('lc1-goal-bar').querySelectorAll('[data-segment]')];
    expect(segments.map((s) => s.getAttribute('data-segment'))).toEqual(['green', 'amber', 'red', 'stale', 'unmeasured']);
    expect((segments[0] as HTMLElement).style.flexGrow).toBe('3');
  });

  it('previews a verdict on hover, pins it on press, and clears it with Esc', () => {
    renderLayer1(<Layer1 />, healthyMix());
    const amber = document.querySelector<HTMLElement>('[data-legend="amber"]')!;
    const lit = () => [...document.querySelectorAll('[data-card]')]
      .filter((c) => c.getAttribute('data-highlight') === 'on').map((c) => c.getAttribute('data-card'));
    expect(document.querySelectorAll('[data-legend]')).toHaveLength(6);
    expect(card('gate').getAttribute('data-highlight')).toBe('none');

    fireEvent.pointerEnter(amber);
    expect(lit()).toEqual(['gate', 'tests']);
    expect(card('land').getAttribute('data-highlight')).toBe('off');
    fireEvent.pointerLeave(amber);
    expect(card('land').getAttribute('data-highlight')).toBe('none');

    fireEvent.click(document.querySelector('[data-legend="red"]')!);
    expect(document.querySelector('[data-legend="red"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(lit()).toEqual(['land']);
    // A preview wins while it lasts, then the pin returns.
    fireEvent.pointerEnter(amber);
    expect(lit()).toEqual(['gate', 'tests']);
    fireEvent.pointerLeave(amber);
    expect(lit()).toEqual(['land']);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(lit()).toEqual([]);
    expect(document.querySelector('[data-legend="red"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('dims the surface of the cards outside the highlight, never their text', () => {
    renderLayer1(<Layer1 />, healthyMix());
    fireEvent.click(document.querySelector('[data-legend="green"]')!);
    const off = card('land');
    expect(off.getAttribute('data-highlight')).toBe('off');
    // No opacity on the card or on any text inside it: only drawn parts fade.
    expect(off.className).not.toMatch(/\bopacity-/);
    for (const el of off.querySelectorAll('[data-row="verdict"] *, [data-row="head"] span')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/\bopacity-[1-8]\d?\b/);
    }
    expect(off.querySelector('[data-meter]')!.className).toContain('opacity-40');
  });
});

describe('Layer-1 peek', () => {
  it('opens on focus after a rest, with every metric and the earlier measure, and closes on blur', () => {
    vi.useFakeTimers();
    renderLayer1(<Layer1 />, healthyMix());
    fireEvent.focus(screen.getByTestId('lc-node-gate'));
    expect(screen.queryByTestId('lc1-peek')).toBeNull();
    act(() => { vi.advanceTimersByTime(PEEK_DELAY_MS); });

    const peek = screen.getByTestId('lc1-peek');
    expect(peek.getAttribute('data-step')).toBe('gate');
    expect(peek.textContent).toContain('tsc 74s over 60s budget');
    expect(peek.querySelectorAll('[data-metric]')).toHaveLength(2);
    expect(peek.querySelector('[data-metric="pass_rate"]')!.textContent).toContain('n = 10');
    const before = screen.getByTestId('lc1-peek-previous');
    expect(before.querySelector('[data-health="green"]')).toBeTruthy();
    expect(before.textContent).toContain('100%');

    fireEvent.blur(screen.getByTestId('lc-node-gate'));
    expect(screen.queryByTestId('lc1-peek')).toBeNull();
  });

  it('lists the recent outcomes as labelled marks, has no earlier measure for docs, and closes on Esc', () => {
    vi.useFakeTimers();
    renderLayer1(<Layer1 />, mixWithEvidence());
    fireEvent.pointerEnter(card('docs'));
    act(() => { vi.advanceTimersByTime(PEEK_DELAY_MS); });
    const peek = screen.getByTestId('lc1-peek');
    expect(peek.getAttribute('data-step')).toBe('docs');
    expect(screen.queryByTestId('lc1-peek-previous')).toBeNull();
    const marks = [...screen.getByTestId('lc-dots-docs').querySelectorAll('[data-outcome]')].map((m) => m.getAttribute('data-outcome'));
    // Oldest left, newest right; a change that recorded nothing for docs reads unknown.
    expect(marks).toEqual(['unknown', 'done', 'skipped']);
    expect(peek.textContent).toContain('Done 1, Skipped 1, Unknown 1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('lc1-peek')).toBeNull();
  });

  it('moves straight to the next card once a peek is showing', () => {
    vi.useFakeTimers();
    renderLayer1(<Layer1 />, healthyMix());
    fireEvent.pointerEnter(card('gate'));
    act(() => { vi.advanceTimersByTime(PEEK_DELAY_MS); });
    fireEvent.pointerLeave(card('gate'));
    fireEvent.pointerEnter(card('tests'));
    expect(screen.getByTestId('lc1-peek').getAttribute('data-step')).toBe('tests');
  });
});
