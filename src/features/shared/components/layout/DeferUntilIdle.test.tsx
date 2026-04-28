import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DeferUntilIdle } from './DeferUntilIdle';

describe('DeferUntilIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders fallback before the threshold fires', () => {
    render(
      <DeferUntilIdle priority="next-frame" fallback={<span>loading</span>}>
        <span>content</span>
      </DeferUntilIdle>,
    );
    expect(screen.queryByText('content')).toBeNull();
    expect(screen.getByText('loading')).toBeTruthy();
  });

  it('renders children synchronously when immediate=true', () => {
    render(
      <DeferUntilIdle immediate>
        <span>content</span>
      </DeferUntilIdle>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('renders children synchronously with priority=mount-after', () => {
    render(
      <DeferUntilIdle priority="mount-after">
        <span>content</span>
      </DeferUntilIdle>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('mounts children after a setTimeout fallback for idle priority (jsdom has no rIC)', async () => {
    render(
      <DeferUntilIdle priority="idle">
        <span>content</span>
      </DeferUntilIdle>,
    );
    expect(screen.queryByText('content')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('mounts children after a single rAF for next-frame priority', async () => {
    render(
      <DeferUntilIdle priority="next-frame">
        <span>content</span>
      </DeferUntilIdle>,
    );
    expect(screen.queryByText('content')).toBeNull();
    await act(async () => {
      // rAF fires inside vi.advanceTimersByTime in jsdom-fake-timer mode
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('uses requestIdleCallback when available', async () => {
    const rIC = vi.fn((cb: () => void) => {
      setTimeout(cb, 0);
      return 42;
    });
    const cIC = vi.fn();
    Object.assign(window, { requestIdleCallback: rIC, cancelIdleCallback: cIC });

    render(
      <DeferUntilIdle priority="idle">
        <span>content</span>
      </DeferUntilIdle>,
    );
    expect(rIC).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText('content')).toBeTruthy();

    // Cleanup
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  });
});
