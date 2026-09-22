import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TypedLine } from '../shared/TypedLine';

const motion = vi.hoisted(() => ({ shouldAnimate: true }));
vi.mock('@/hooks/utility/interaction/useMotion', () => ({
  useMotion: () => ({ shouldAnimate: motion.shouldAnimate, duration: 0.25, spring: {}, transition: {}, staggerDelay: 0 }),
}));

const TEXT = 'Hi, I am Athena.';

beforeEach(() => {
  motion.shouldAnimate = true;
});

describe('TypedLine', () => {
  it('reveals instantly under reduced motion and fires onDone once', () => {
    motion.shouldAnimate = false;
    const onDone = vi.fn();
    const { rerender } = render(<TypedLine lineId="a" text={TEXT} onDone={onDone} />);
    const p = screen.getByTestId('create-athena-typed-line');
    expect(p).toHaveTextContent(TEXT);
    expect(p).toHaveAttribute('aria-label', TEXT);
    expect(p).toHaveAttribute('data-complete', 'true');
    expect(onDone).toHaveBeenCalledTimes(1);
    rerender(<TypedLine lineId="a" text={TEXT} onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('types on a rAF clock, click reveals the rest, a new lineId re-types', () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const flush = (ms: number) => {
      now += ms;
      const pending = frames.splice(0);
      act(() => pending.forEach((cb) => cb(now)));
    };
    const onDone = vi.fn();
    const { rerender } = render(<TypedLine lineId="a" text={TEXT} onDone={onDone} />);
    const p = screen.getByTestId('create-athena-typed-line');
    expect(p).toHaveAttribute('data-complete', 'false');
    expect(p).toHaveAttribute('aria-label', TEXT);

    flush(0); // first frame stamps `start`
    flush(250); // ~7 chars at 28 cps
    expect(p.textContent?.length).toBe(7);
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(p);
    expect(p).toHaveTextContent(TEXT);
    expect(onDone).toHaveBeenCalledTimes(1);
    // A frame that was already queued must not roll the count back.
    flush(16);
    expect(p).toHaveTextContent(TEXT);

    rerender(<TypedLine lineId="b" text="Again." onDone={onDone} />);
    expect(p).toHaveAttribute('data-complete', 'false');
    flush(0);
    flush(5000);
    expect(p).toHaveTextContent('Again.');
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
