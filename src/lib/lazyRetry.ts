import { lazy, createElement, type ComponentType } from 'react';

/**
 * True when an error is a failed dynamic-import (chunk fetch) rather than a
 * render bug. Covers the engine-specific messages: Chromium/WebView2
 * ("Failed to fetch dynamically imported module"), WebKit ("Importing a
 * module script failed"), Firefox ("error loading dynamically imported
 * module"). Error boundaries use this to offer a reload — resetting the
 * boundary alone can't fix a chunk that no longer exists on the server
 * (post-deploy hash change) or a dev server that went away.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

/** The import specifier out of `() => import('...')`, for error messages. */
function describeImport(importFn: () => Promise<unknown>): string {
  const m = /import\(\s*["']([^"']+)["']/.exec(importFn.toString());
  return m?.[1] ?? '<lazy module>';
}

/**
 * True when a lazy module resolved but carried no component — the failure
 * mode React otherwise reports as the cryptic "Element type is invalid.
 * Received a promise that resolves to: undefined".
 */
export function isMissingComponentExport(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.startsWith('lazyRetry: ');
}

/**
 * The module resolved — but is the default actually a component? Two real
 * ways it is not: (1) a renamed/removed export behind a `.then(m => ({ default:
 * m.X }))` adapter, and (2) a dev server serving a stale EMPTY transform of a
 * file that was saved in two steps (observed 2026-08-27: NotificationCenter.tsx
 * served as a 183-byte sourcemap stub, which took every global overlay down
 * with it). Throwing a NAMED error here means the boundary log says which
 * module, instead of React's element-type message that names nothing.
 */
function assertComponentModule<T>(mod: { default: T }, importFn: () => Promise<unknown>): { default: T } {
  const d = mod?.default;
  if (d == null) {
    throw new Error(
      `lazyRetry: ${describeImport(importFn)} resolved without a default export ` +
        '(renamed export, or a stale/empty dev-server transform — reload the app if it persists)',
    );
  }
  return mod;
}

/**
 * Import with one automatic retry after 1.5 s — handles transient network
 * blips and stale-chunk 404s after a deploy.
 */
function importWithRetry<T>(importFn: () => Promise<T>): Promise<T> {
  return (
    importFn()
      .catch(
        // eslint-disable-next-line custom/async-catch-requires-helper -- retry combinator, not a swallow: must return a Promise<T> that resolves/rejects from the retried import, which silentCatch's void-returning handler can't express. A permanent failure still propagates to the caller (see lazyRetry docstring) and is surfaced by the nearest ErrorBoundary.
        () =>
          new Promise<T>((resolve, reject) =>
            setTimeout(() => importFn().then(resolve, reject), 1500),
          ),
      )
  );
}

/**
 * Drop-in replacement for `React.lazy` with one automatic import retry, whose
 * *permanent* failures surface to the nearest ErrorBoundary instead of hanging.
 *
 * **Problem**: `React.lazy` calls its factory once and caches the resulting
 * promise. A transient blip (network hiccup, dev server mid-restart) that
 * happens to fail both `importWithRetry` attempts would otherwise cache the
 * rejection forever. And a chunk that can NEVER load — a dead dev server on
 * :1420, a stale post-deploy hash — leaves the Suspense boundary showing its
 * fallback with no recovery.
 *
 * **Fix**: keep ONE stable `React.lazy`. `importWithRetry` covers the transient
 * case; a permanent rejection is rethrown to the nearest ErrorBoundary, whose
 * chunk-error UI (`isChunkLoadError` → "Reload app", see `ErrorBoundary.tsx`)
 * is the reliable recovery — a full reload re-fetches the (now-available)
 * chunk. "Try Again" simply re-shows the error; it does not loop.
 *
 * **Why not swap to a fresh `React.lazy` on rejection?** An earlier version did
 * exactly that inside the failing promise's `.catch`, to retry without a full
 * reload. But the swap raced React's error propagation: React remounts the
 * suspended child when its promise settles, so it rendered the fresh *pending*
 * lazy and **re-suspended** instead of throwing the rejection to the boundary.
 * Against a permanently-unreachable chunk this looped forever — the user saw an
 * **infinite loading skeleton** and never the recoverable error UI. A single
 * stable instance is what guarantees the failure actually reaches the boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.FC<React.ComponentProps<T>> {
  // The export check sits INSIDE the retried thunk, so an empty module gets
  // the same single 1.5 s retry a failed fetch does before it surfaces.
  const LazyImpl = lazy<T>(() =>
    importWithRetry<{ default: T }>(() => importFn().then((mod) => assertComponentModule(mod, importFn))),
  );

  // Thin, stable wrapper — Suspense still works: the inner lazy throws its
  // thenable and the nearest <Suspense> catches it; on a permanent rejection it
  // throws the (cached) error, which the nearest ErrorBoundary catches.
  function RetryableLazy(props: React.ComponentProps<T>) {
    return createElement(LazyImpl, props);
  }

  return RetryableLazy;
}
