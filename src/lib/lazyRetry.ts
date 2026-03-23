import { lazy, createElement, type ComponentType } from 'react';

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
