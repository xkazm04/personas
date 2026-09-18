import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Silence } from '@/hooks/execution/useReplayTimeline';
import { TimelineScrubber } from '../TimelineScrubber';

const SILENCES: Silence[] = [
  { start_ms: 2_000, end_ms: 20_000 },
  { start_ms: 50_000, end_ms: 56_000 },
];

function renderScrubber(over: Partial<React.ComponentProps<typeof TimelineScrubber>> = {}) {
  return render(
    <TimelineScrubber
      currentMs={0}
      totalMs={100_000}
      toolSteps={[]}
      activeStepIndex={null}
      forkPoint={null}
      onScrub={() => {}}
      onSetForkPoint={() => {}}
      {...over}
    />,
  );
}

describe('TimelineScrubber silences', () => {
  it('draws a band for each recorded silence, at its recorded position', () => {
    const { container } = renderScrubber({ silences: SILENCES, hasRecordedTempo: true });
    const bands = [...container.querySelectorAll<HTMLElement>('[data-testid="scrubber-silence"]')];
    expect(bands).toHaveLength(2);
    // 2s-20s of a 100s run: 2% in, 18% wide.
    expect(bands[0]!.style.left).toBe('2%');
    expect(bands[0]!.style.width).toBe('18%');
    expect(bands[1]!.style.left).toBe('50%');
    expect(bands[1]!.style.width).toBe('6%');
  });

  it('draws nothing when the log carried no timestamps to measure a gap from', () => {
    renderScrubber({ silences: SILENCES, hasRecordedTempo: false });
    expect(screen.queryByTestId('scrubber-silence')).toBeNull();
  });

  it('draws nothing when the run recorded no silence at all', () => {
    renderScrubber({ silences: [], hasRecordedTempo: true });
    expect(screen.queryByTestId('scrubber-silence')).toBeNull();
  });

  it('leaves the slider contract untouched -- no new chrome, no aria change', () => {
    const { container } = renderScrubber({ silences: SILENCES, hasRecordedTempo: true });
    const slider = container.querySelector('[role="slider"]')!;
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('100000');
    // The bands are decoration on the track: out of the a11y tree and inert.
    for (const band of container.querySelectorAll('[data-testid="scrubber-silence"]')) {
      expect(band.getAttribute('aria-hidden')).toBe('true');
      expect(band.className).toContain('pointer-events-none');
    }
  });
});

// ---------------------------------------------------------------------------
// The other half of the same fact: the scrubber has DRAWN these bands for a
// while, and transport could only step tool boundaries — so 8x playback still
// spent the wall clock crawling through them. `findSilenceSkipTarget` is the
// predicate behind the new control, and its whole job is to be conservative:
// it may leave a silence, and it may never leave anything else.
// ---------------------------------------------------------------------------

import { findSilenceSkipTarget } from '@/hooks/execution/useReplayTimeline';

describe('findSilenceSkipTarget', () => {
  it('lands on the end of the silence the playhead is standing in', () => {
    expect(findSilenceSkipTarget(5_000, SILENCES, true)).toBe(20_000);
    expect(findSilenceSkipTarget(51_000, SILENCES, true)).toBe(56_000);
  });

  it('includes the silence start and excludes its end, so a skip never repeats', () => {
    expect(findSilenceSkipTarget(2_000, SILENCES, true)).toBe(20_000);
    // Standing exactly where the last skip put you is standing in live output.
    expect(findSilenceSkipTarget(20_000, SILENCES, true)).toBeNull();
  });

  it('no-ops outside a silence rather than jumping to the next one', () => {
    // 30s is live output between two silences. Skipping to 56_000 would carry
    // the playhead over everything logged in between.
    expect(findSilenceSkipTarget(30_000, SILENCES, true)).toBeNull();
    expect(findSilenceSkipTarget(0, SILENCES, true)).toBeNull();
  });

  it('no-ops when the run recorded no silence', () => {
    expect(findSilenceSkipTarget(5_000, [], true)).toBeNull();
  });

  it('refuses to skip an interpolated tempo', () => {
    // Without recorded timestamps every offset was apportioned evenly, so a
    // "gap" is a guess and skipping it would skip real output.
    expect(findSilenceSkipTarget(5_000, SILENCES, false)).toBeNull();
  });
});
