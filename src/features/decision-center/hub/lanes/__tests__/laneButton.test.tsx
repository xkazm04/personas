/**
 * The lane button reads as a lane (mandate-lanes WP7 polish of WP4): the
 * lane's NAME is always printed, the count is its own figure, and the key is
 * a keycap inside the button that is the first thing to go when the bar is
 * narrow; the name never goes.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { LaneCount } from '../../../lanes/laneModel';
import { LaneButton, type LaneFit } from '../LaneButton';

const COUNT: LaneCount = { n: 2, lamp: 'warning', failed: false, failedSources: [] };

function renderAt(fit: LaneFit) {
  return render(<LaneButton lane="sign" count={COUNT} settled fit={fit} open={false} onPress={vi.fn()} />);
}

describe('LaneButton', () => {
  it('prints the name, the count and the key when roomy', () => {
    renderAt(0);
    const btn = screen.getByTestId('decision-lane-sign');
    expect(screen.getByTestId('decision-lane-sign-name').textContent).toBe('Sign');
    expect(btn.querySelector('kbd')?.textContent).toBe('2');
    expect(btn.querySelector('.au-count')?.textContent).toBe('2');
  });

  it('keeps the keycap when tight, drops only the keycap when narrow', () => {
    const { unmount } = renderAt(1);
    expect(screen.getByTestId('decision-lane-sign').querySelector('kbd')).not.toBeNull();
    unmount();
    renderAt(2);
    const btn = screen.getByTestId('decision-lane-sign');
    expect(btn.querySelector('kbd')).toBeNull();
    expect(screen.getByTestId('decision-lane-sign-name').textContent).toBe('Sign');
    // The key still reaches assistive tech and the tooltip.
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('2');
  });
});
