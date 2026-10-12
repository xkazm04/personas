// The Activity surface's cold-open choreography, asserted at the two
// mechanisms it is built from: the coarse beats (`useBuildUp`) and the
// per-item reveal (`useProgressiveReveal` / `RevealItem`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, act, fireEvent, screen } from '@testing-library/react';
import {
  BEAT, BEAT_MS, TOTAL_BEATS, useActivityEntrance, _resetActivityEntranceForTests,
} from '../useActivityEntrance';
import {
  useProgressiveReveal, useRevealTracker, __resetSurfaceRevealForTests,
} from '@/hooks/utility/interaction/useProgressiveReveal';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { UsageGhost } from '../prototype/entry-e/SlotGhosts';

function reduceMotion(on: boolean) {
  if (on) document.documentElement.setAttribute('data-motion', 'reduce');
  else document.documentElement.removeAttribute('data-motion');
}

beforeEach(() => {
  _resetActivityEntranceForTests();
  __resetSurfaceRevealForTests();
  reduceMotion(false);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  reduceMotion(false);
});

describe('useActivityEntrance — the four beats', () => {
  it('plays chrome, tiles, rail, usage in order, one every BEAT_MS', () => {
    const { result } = renderHook(() => useActivityEntrance());
    expect(result.current.warm).toBe(false);
    expect(result.current.beat).toBe(BEAT.chrome);

    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    expect(result.current.beat).toBe(BEAT.tiles);

    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    expect(result.current.beat).toBe(BEAT.rail);

    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    expect(result.current.beat).toBe(BEAT.usage);
    expect(result.current.beat).toBe(TOTAL_BEATS);
  });

  it('never lets a beat precede its predecessor', () => {
    const seen: number[] = [];
    const { result } = renderHook(() => useActivityEntrance());
    seen.push(result.current.beat);
    for (let i = 0; i < 12; i++) {
      act(() => { vi.advanceTimersByTime(BEAT_MS / 3); });
      seen.push(result.current.beat);
    }
    expect(seen[0]).toBe(BEAT.chrome);
    expect(seen.at(-1)).toBe(TOTAL_BEATS);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    // Every beat is actually visited — no step is skipped over.
    expect(new Set(seen)).toEqual(new Set([BEAT.chrome, BEAT.tiles, BEAT.rail, BEAT.usage]));
  });

  it('is instant on the second open of the same app session', () => {
    const first = renderHook(() => useActivityEntrance());
    act(() => { vi.advanceTimersByTime(BEAT_MS * TOTAL_BEATS); });
    expect(first.result.current.beat).toBe(TOTAL_BEATS);
    first.unmount();

    const second = renderHook(() => useActivityEntrance());
    expect(second.result.current.warm).toBe(true);
    expect(second.result.current.beat).toBe(TOTAL_BEATS);
  });

  it('an open abandoned mid-choreography still plays the next one', () => {
    const first = renderHook(() => useActivityEntrance());
    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    expect(first.result.current.beat).toBe(BEAT.tiles);
    first.unmount();

    const second = renderHook(() => useActivityEntrance());
    expect(second.result.current.beat).toBe(BEAT.chrome);
  });

  it('reduced motion: every beat is in on the first frame', () => {
    reduceMotion(true);
    const { result } = renderHook(() => useActivityEntrance());
    expect(result.current.warm).toBe(false);
    expect(result.current.beat).toBe(TOTAL_BEATS);
  });

  it('data arriving mid-choreography neither restarts nor stalls it', () => {
    // The key is one of two literals chosen once per mount; a re-render with
    // wholly different fleet contents cannot reach it.
    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: string[] }) => ({ sessions, entrance: useActivityEntrance() }),
      { initialProps: { sessions: [] as string[] } },
    );
    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    expect(result.current.entrance.beat).toBe(BEAT.tiles);

    rerender({ sessions: ['s1'] });
    rerender({ sessions: ['s1', 's2'] });
    // Not restarted: still on the beat the clock says.
    expect(result.current.entrance.beat).toBe(BEAT.tiles);

    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    rerender({ sessions: ['s1', 's2', 's3'] });
    expect(result.current.entrance.beat).toBe(BEAT.rail);

    // Not stalled: it still finishes on the original schedule.
    act(() => { vi.advanceTimersByTime(BEAT_MS); });
    expect(result.current.entrance.beat).toBe(TOTAL_BEATS);
  });
});

/** The options PlanPlates hands the reveal, kept in step with that call site. */
const USAGE_REVEAL = { initialCount: 1, targetMs: 200, intervalMs: 60, minChunk: 1, resetKey: 'activity-usage' };

function Plates({ ids, enabled = true }: { ids: string[]; enabled?: boolean }) {
  const reveal = useProgressiveReveal(ids.length, { ...USAGE_REVEAL, enabled });
  const enter = useRevealTracker('activity-usage', 'activity-usage');
  return (
    <div>
      {ids.slice(0, reveal.count).map((id, i) => (
        <RevealItem key={id} revealId={id} order={i - reveal.newSince} {...enter} data-testid={`plate-${id}`}>
          {id}
        </RevealItem>
      ))}
    </div>
  );
}

describe('the per-item reveal the plates and figures use', () => {
  it('staggers the tiles in on a cold open', () => {
    render(<Plates ids={['a', 'b', 'c']} />);
    expect(screen.queryAllByTestId(/^plate-/)).toHaveLength(1);
    expect(screen.getByTestId('plate-a').className).toContain('animate-fade-in');

    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryAllByTestId(/^plate-/)).toHaveLength(3);
  });

  it('reduced motion: every tile is present at once and none animates', () => {
    reduceMotion(true);
    render(<Plates ids={['a', 'b', 'c']} />);
    const plates = screen.queryAllByTestId(/^plate-/);
    expect(plates).toHaveLength(3);
    for (const p of plates) expect(p.className).not.toContain('animate-fade-in');
  });

  it('a return to the surface replays nothing, while a new id still enters alone', () => {
    const first = render(<Plates ids={['a', 'b']} />);
    act(() => { vi.advanceTimersByTime(200); });
    // jsdom has no `AnimationEvent`, so react-dom binds `onAnimationEnd` to
    // the vendor-prefixed `webkitAnimationEnd` — `fireEvent.animationEnd`
    // never reaches it (same note as `UnifiedTableRowMemo.test.tsx`).
    for (const p of screen.queryAllByTestId(/^plate-/)) {
      fireEvent(p, new Event('webkitAnimationEnd', { bubbles: true }));
    }
    first.unmount();

    render(<Plates ids={['a', 'b', 'c']} enabled={false} />);
    expect(screen.getByTestId('plate-a').className).not.toContain('animate-fade-in');
    expect(screen.getByTestId('plate-b').className).not.toContain('animate-fade-in');
    expect(screen.getByTestId('plate-c').className).toContain('animate-fade-in');
  });
});

describe('the reserved space the lazy slots land in', () => {
  it('is a panel at rest, never a spinner — nothing announces loading', () => {
    const { container } = render(<UsageGhost />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    // Both are aria-hidden, so the same element serving as the Suspense
    // fallback cannot be announced as a change either.
    for (const id of ['entry-e-usage-ghost']) {
      expect(screen.getByTestId(id).getAttribute('aria-hidden')).toBe('true');
    }
  });
});
