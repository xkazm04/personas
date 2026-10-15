/**
 * The dock's yes | no pair stands side by side only while both verbs fit on
 * one line in half the dock, measured in the reader's own words (residue item
 * 4: "Accept" + "Send back" counted 15 characters, passed the old character
 * test and still wrapped "Send back" onto two lines at 1280 wide).
 *
 * jsdom lays nothing out, so the widths are stubbed on the elements: a dock
 * 300px wide with an 8px gap leaves 146px a column; each button's chrome
 * (icon, padding, keycap) is the button's width minus its verb slot's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { useVerdictPairFit } from '../useVerdictPairFit';

function stub(el: Element, prop: 'offsetWidth' | 'clientWidth', px: number): void {
  Object.defineProperty(el, prop, { configurable: true, get: () => px });
}

/** The pair's real markup shape: a grid of two buttons, each a verb inside its slot. */
function Pair({ labels }: { labels: [string, string] }) {
  const fit = useVerdictPairFit(labels);
  return (
    <div ref={fit.ref} data-testid="pair" data-stacked={fit.stacked ? '' : undefined} style={{ columnGap: '8px' }}>
      {labels.map((l, i) => (
        <div key={i} data-verdict="" data-testid={`btn-${i}`}>
          <span data-testid={`slot-${i}`}><span data-verdict-text="" data-testid={`text-${i}`}>{l}</span></span>
        </div>
      ))}
    </div>
  );
}

/**
 * Lay the pair out, then change its words so the hook measures the laid-out
 * elements (it measures before paint on every change of words). `textPx` is
 * each verb's one-line width; every button carries 70px of chrome.
 */
function measureWith(labels: [string, string], textPx: [number, number]): HTMLElement {
  const { rerender } = render(<Pair labels={['', '']} />);
  stub(screen.getByTestId('pair'), 'clientWidth', 300);
  [0, 1].forEach((i) => {
    stub(screen.getByTestId(`btn-${i}`), 'offsetWidth', 146);
    stub(screen.getByTestId(`slot-${i}`), 'clientWidth', 76);
    stub(screen.getByTestId(`text-${i}`), 'offsetWidth', textPx[i]!);
  });
  rerender(<Pair labels={labels} />);
  return screen.getByTestId('pair');
}

afterEach(cleanup);

describe('useVerdictPairFit', () => {
  it('keeps two columns while both verbs fit beside each other', () => {
    // 64px + 70px = 134px <= 146px a column.
    expect(measureWith(['Approve', 'Reject'], [64, 50]).hasAttribute('data-stacked')).toBe(false);
  });

  it('stacks when one verb would wrap in half the dock, whatever its character count', () => {
    // 80px of verb + 70px of chrome = 150px > 146px a column.
    expect(measureWith(['Accept', 'Send back'], [52, 80]).hasAttribute('data-stacked')).toBe(true);
  });

  it('stays side by side when both verbs fit, even in a longer-character language', () => {
    expect(measureWith(['Принять', 'Вернуть'], [60, 62]).hasAttribute('data-stacked')).toBe(false);
  });
});
