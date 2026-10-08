import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { healthyMix, soloV0 } from '../../../journey/__tests__/fixtures';
import { CollarView } from '../collar/CollarView';
import { renderLayer1 } from './renderLayer1';

const SIX = ['green', 'amber', 'red', 'unmeasured', 'instructed', 'stale'];

// The collar rail is the one Layer-1 view since the owner's pick (WP4); the
// orbit and lane-board directions were deleted with their switcher.
const View = CollarView;

describe('Layer-1 collar rail', () => {
  it('draws all six verdicts, each on its own step', () => {
    renderLayer1(<View />, healthyMix());
    const nodes = screen.getAllByTestId(/^lc-node-/);
    expect(nodes).toHaveLength(10);
    expect(new Set(nodes.map((n) => n.getAttribute('data-health')))).toEqual(new Set(SIX));
    expect(screen.getByTestId('lc-node-sync').getAttribute('data-health')).toBe('unmeasured');
    expect(screen.getByTestId('lc-node-commit').getAttribute('data-health')).toBe('stale');
    expect(screen.getByTestId('lc-node-frame').getAttribute('data-health')).toBe('instructed');
    // The verdict pill carries the same mark, so the look follows the data.
    for (const h of SIX) expect(document.querySelectorAll(`span[data-health="${h}"]`).length).toBeGreaterThan(0);
    expect(screen.getByTestId('lc-lane-before').querySelectorAll('[data-testid^="lc-node-"]')).toHaveLength(4);
    expect(screen.getByTestId('lc-lane-after').querySelectorAll('[data-testid^="lc-node-"]')).toHaveLength(6);
  });

  it('renders a null metric as N/A, never as 0', () => {
    renderLayer1(<View />, healthyMix());
    const cell = screen.getByTestId('lc-node-sync').closest('li')!;
    expect(cell.querySelector('[data-na="true"]')?.textContent).toBe('N/A');
    expect(cell.textContent).not.toMatch(/(^|\D)0\s?%/);
    // A measured rate on another step is a real figure.
    expect(screen.getByTestId('lc-node-land').closest('li')!.textContent).toContain('40%');
  });

  it('opens a step on click and walks the journey with the arrow keys', () => {
    const { openStep } = renderLayer1(<View />, healthyMix());
    fireEvent.click(screen.getByTestId('lc-node-gate'));
    expect(openStep).toHaveBeenCalledWith('gate');
    expect(screen.getByTestId('lc-node-gate').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('lc-journey-track'), { key: 'ArrowRight' });
    expect(screen.getByTestId('lc-node-tests').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('lc-node-tests').getAttribute('tabindex')).toBe('0');
  });

  it('reads well with no health at all: every step unmeasured or instructed', () => {
    renderLayer1(<View />, soloV0());
    const verdicts = new Set(screen.getAllByTestId(/^lc-node-/).map((n) => n.getAttribute('data-health')));
    expect(verdicts).toEqual(new Set(['unmeasured', 'instructed']));
    expect(screen.queryByTestId('lc1-goal')).toBeNull();
    expect(document.querySelectorAll('[data-na="true"]').length).toBeGreaterThan(0);
  });

  it('draws the goal as a quantity when the project has one', () => {
    renderLayer1(<View />, healthyMix());
    const goal = screen.getByTestId('lc1-goal');
    expect(goal.textContent).toContain('3 of 8 measurable steps green, 2 instructed');
    expect(goal.querySelector('[data-kit="UnitStrip"]')).toBeTruthy();
  });

  it('keys the six verdicts beside the goal, with their counts', () => {
    renderLayer1(<View />, healthyMix());
    expect(document.querySelector('[data-legend="amber"]')?.closest('[data-kit]')).toBeTruthy();
    expect(document.querySelectorAll('[data-legend]')).toHaveLength(6);
  });
});
