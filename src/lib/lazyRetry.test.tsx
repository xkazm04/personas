import { describe, expect, it, vi, afterEach } from 'vitest';
import { Component, Suspense, type ReactNode } from 'react';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { isChunkLoadError, lazyRetry } from './lazyRetry';

describe('isChunkLoadError', () => {
  it('matches the Chromium/WebView2 dynamic-import failure', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: http://localhost:1420/src/features/teams/sub_teamWorkspace/TeamCanvas.tsx',
        ),
      ),
    ).toBe(true);
  });

  it('matches the WebKit module-script failure', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  });

  it('matches the Firefox dynamic-import failure', () => {
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: x'))).toBe(true);
  });

  it('rejects ordinary render errors', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new Error('Maximum update depth exceeded'))).toBe(false);
  });

  it('tolerates non-Error inputs', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: x')).toBe(true);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
  });
});

// ── lazyRetry recovery behaviour ────────────────────────────────────────────
//
// These lock in the fix for the "infinite loading skeleton" regression: when a
// chunk can never be fetched (dead dev server on :1420, stale post-deploy hash)
// the failure MUST reach the nearest ErrorBoundary — it must NOT loop back onto
// the Suspense fallback. And once the boundary is reset, the import must be
// re-attempted so a transient outage can recover without a hard reload.

const CHUNK_ERR = 'Failed to fetch dynamically imported module: http://localhost:1420/x.tsx';

function Loaded() {
  return <div>LOADED_CONTENT</div>;
}

/** Minimal boundary mirroring the app's recovery contract: on catch it renders
 *  a "Retry" affordance whose click clears the error and remounts children. */
class RetryBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <button onClick={() => this.setState({ hasError: false })}>RETRY</button>
      );
    }
    return this.props.children;
  }
}

describe('lazyRetry recovery', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('surfaces a permanent chunk failure to the ErrorBoundary instead of looping on the fallback', async () => {
    vi.useFakeTimers();
    // Silence the expected React error-boundary console noise for this case.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const importFn = vi.fn(() => Promise.reject(new TypeError(CHUNK_ERR)));
    const Lazy = lazyRetry(importFn as unknown as () => Promise<{ default: typeof Loaded }>);

    render(
      <RetryBoundary>
        <Suspense fallback={<div>LOADING</div>}>
          <Lazy />
        </Suspense>
      </RetryBoundary>,
    );

    expect(screen.getByText('LOADING')).toBeTruthy();

    // First attempt rejects; importWithRetry schedules one retry at +1500ms,
    // which also rejects. After that the boundary — not the skeleton — must win.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(screen.queryByText('LOADING')).toBeNull();
    expect(screen.getByText('RETRY')).toBeTruthy();
    // One attempt + one retry per mount.
    expect(importFn).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it('does not loop back onto the skeleton when the boundary is reset after a permanent failure', async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const importFn = vi.fn(() => Promise.reject(new TypeError(CHUNK_ERR)));
    const Lazy = lazyRetry(importFn as unknown as () => Promise<{ default: typeof Loaded }>);

    render(
      <RetryBoundary>
        <Suspense fallback={<div>LOADING</div>}>
          <Lazy />
        </Suspense>
      </RetryBoundary>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByText('RETRY')).toBeTruthy();
    const callsBeforeReset = importFn.mock.calls.length;

    // Reset the boundary ("Try Again"): the subtree remounts and the cached
    // rejection is rethrown synchronously — it must land back on the error UI,
    // NOT re-suspend onto the loading skeleton (the infinite-skeleton bug).
    await act(async () => {
      fireEvent.click(screen.getByText('RETRY'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(screen.queryByText('LOADING')).toBeNull();
    expect(screen.getByText('RETRY')).toBeTruthy();
    // The stable instance replays its cached error — no fresh import round-trip.
    expect(importFn.mock.calls.length).toBe(callsBeforeReset);
    errSpy.mockRestore();
  });

  it('reuses a resolved module across remounts without re-importing (no fallback re-flash)', async () => {
    const importFn = vi.fn(() => Promise.resolve({ default: Loaded }));
    const Lazy = lazyRetry(importFn as unknown as () => Promise<{ default: typeof Loaded }>);

    const first = render(
      <Suspense fallback={<div>LOADING</div>}>
        <Lazy />
      </Suspense>,
    );
    await act(async () => {});
    expect(screen.getByText('LOADED_CONTENT')).toBeTruthy();
    const callsAfterFirst = importFn.mock.calls.length;

    first.unmount();

    render(
      <Suspense fallback={<div>LOADING</div>}>
        <Lazy />
      </Suspense>,
    );
    await act(async () => {});

    expect(screen.getByText('LOADED_CONTENT')).toBeTruthy();
    // Healthy impl reused — no rebuild, so no additional import round-trip.
    expect(importFn.mock.calls.length).toBe(callsAfterFirst);
  });
});
