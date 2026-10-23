/**
 * The lane button is built as the chip beside it (design pass, 2026-10-15):
 * the lane's NAME is always printed, the count is its own figure, and the key
 * lives in the tooltip and `aria-keyshortcuts`, never as a keycap in the chip
 * ("Breach 4 [1]" read as two numbers). The lead lane wears the lead chip's tint.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { LaneCount, LaneCounts } from '../../../lanes/laneModel';
import { LaneButton, type LaneFit } from '../LaneButton';
import { leadLane } from '../LaneStrip';

const COUNT: LaneCount = { n: 2, lamp: 'warning', failed: false, failedSources: [] };

function renderAt(fit: LaneFit, isNext = false) {
  return render(<LaneButton lane="sign" count={COUNT} settled fit={fit} isNext={isNext} open={false} onPress={vi.fn()} />);
}

describe('LaneButton', () => {
  it('prints the name and the count, and no keycap', () => {
    renderAt(0);
    const btn = screen.getByTestId('decision-lane-sign');
    expect(screen.getByTestId('decision-lane-sign-name').textContent).toBe('Sign');
    expect(btn.querySelector('.au-count')?.textContent).toBe('2');
    expect(btn.querySelector('kbd')).toBeNull();
    expect(btn.textContent).toBe('Sign2');
  });

  it('keeps the name when tight, and the key reaches the tooltip and assistive tech', () => {
    renderAt(1);
    const btn = screen.getByTestId('decision-lane-sign');
    expect(screen.getByTestId('decision-lane-sign-name').textContent).toBe('Sign');
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('2');
    expect(btn.getAttribute('aria-label')).toContain('key 2');
  });

  it('marks the lead lane like the lead chip', () => {
    renderAt(0, true);
    expect(screen.getByTestId('decision-lane-sign').hasAttribute('data-next')).toBe(true);
  });
});

describe('leadLane', () => {
  const none: LaneCount = { n: 0, lamp: 'neutral', failed: false, failedSources: [] };
  const counts = (over: Partial<LaneCounts>): LaneCounts => ({
    breach: none, sign: none, accept: none, talk: none, orphan: none, ...over,
  });

  it('picks the most urgent operator lane holding something', () => {
    expect(leadLane(counts({
      sign: { n: 1, lamp: 'accent', failed: false, failedSources: [] },
      breach: { n: 4, lamp: 'danger', failed: false, failedSources: [] },
    }))).toBe('breach');
  });

  it('is none when nothing waits, and never Orphans', () => {
    expect(leadLane(counts({ orphan: { n: 3, lamp: 'neutral', failed: false, failedSources: [] } }))).toBeNull();
  });
});
