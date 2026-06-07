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

/**
 * Import with one automatic retry after 1.5 s — handles transient network
 * blips and stale-chunk 404s after a deploy.
 */
function importWithRetry<T>(importFn: () => Promise<T>): Promise<T> {
  return importFn().catch(
    () =>
      new Promise<T>((resolve, reject) =>
        setTimeout(() => importFn().then(resolve, reject), 1500),
      ),
  );
}

/**
 * Drop-in replacement for `React.lazy` that recovers from permanent failure.
 *
 * **Problem**: `React.lazy` calls its factory once and caches the resulting
 * promise.  If both import attempts fail (e.g. network down > 2 s), the
 * rejected promise is cached forever — every future render of that component
 * throws without recovery, requiring a hard reload.
 *
 * **Fix**: On rejection the closure swaps to a *new* `React.lazy` instance.
 * A thin wrapper component always renders the current instance, so the next
 * error-boundary reset triggers a brand-new import attempt instead of
 * replaying the cached error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.FC<React.ComponentProps<T>> {
  type Module = { default: T };
  let LazyImpl: React.LazyExoticComponent<T>;

  function build() {
    LazyImpl = lazy<T>(() => {
      const p = importWithRetry<Module>(importFn);
      // On permanent failure, swap to a fresh React.lazy so the next
      // error-boundary reset gets a clean slate.
      p.catch(() => {
        build();
      });
      return p;
    });
  }

  build();

  // Stable wrapper — always delegates to the current LazyImpl.
  // Suspense still works: the inner lazy throws its thenable and the
  // nearest <Suspense> boundary catches it as usual.
  function RetryableLazy(props: React.ComponentProps<T>) {
    return createElement(LazyImpl, props);
  }

  return RetryableLazy;
}
