/**
 * sentryFacade — what the app's `@sentry/react` imports resolve to in a
 * BUILD (the `sentry-deferred` plugin in vite.config.ts), so the SDK is not on
 * the startup path.
 *
 * WHY. Eighteen eagerly imported modules (systemStore, silentCatch,
 * tauriInvoke, errorRegistry, ...) import `@sentry/react` for a breadcrumb or a
 * captureException, which put the whole SDK - @sentry/core, @sentry/browser
 * and the React layer, ~180 KB before minification - into the startup closure,
 * although `initSentry()` only ever ran after first paint (main.tsx's async
 * phase). Measured 2026-10-25.
 *
 * HOW. Every call before the SDK is up is queued, in order, capped. The first
 * `init()` imports the real package (this module's own import of
 * `@sentry/react` is the one the plugin lets through), initializes it with the
 * same options, and replays the queue (through sentrySdk.ts, which names the
 * seven functions used so the rest of the SDK is tree-shaken). With telemetry off `init()` is never
 * called, so the SDK is never fetched - and the queue, like the real SDK's calls
 * without an init, goes nowhere. After the SDK is up every call goes straight
 * through.
 *
 * Consent: init() and every call read isTelemetryEnabled() (the census rule
 * consent-bypassing-telemetry-import asks callers to move behind a
 * consent-aware facade; this is it, for every module that imported the SDK).
 *
 * Only the surface the app uses is here: init, addBreadcrumb, captureMessage,
 * captureException, withScope, setTag, metrics.*, withErrorBoundary. A new
 * `Sentry.x` in app code fails the build at this module's import - add it here.
 *
 * Vitest does not load vite.config.ts, so specs that vi.mock('@sentry/react')
 * keep mocking the real package; this module has its own spec.
 */
import { Component, type ComponentType, type ReactNode } from 'react';
import type * as SentryReact from '@sentry/react';
import type { SentrySdk } from './sentrySdk';
import { isTelemetryEnabled } from '@/lib/telemetryPreference';
import { silentCatch } from '@/lib/silentCatch';

type Sdk = SentrySdk;
type Call = (sdk: Sdk) => void;

/** Calls made before the SDK is up. Bounded: a boot that never inits must not grow it forever. */
const MAX_QUEUED = 500;
let queue: Call[] = [];
let dropped = 0;
let sdk: Sdk | null = null;
let loading: Promise<Sdk> | null = null;

function run(call: Call): void {
  // Consent is read per call, so withdrawing it mid-session stops emission at
  // once - with the SDK imported directly, nothing ever re-checked it.
  if (!isTelemetryEnabled()) return;
  if (sdk) {
    call(sdk);
    return;
  }
  if (queue.length >= MAX_QUEUED) {
    dropped++;
    return;
  }
  queue.push(call);
}

function load(): Promise<Sdk> {
  // sentrySdk.ts is the one module the plugin lets reach the real package (named imports, tree-shaken).
  loading ??= import('./sentrySdk').then((mod) => mod.sdk);
  return loading;
}

export function init(options: Parameters<Sdk['init']>[0]): ReturnType<Sdk['init']> {
  // The consent gate lives here as well as in main.tsx: no consent, no SDK fetch.
  if (!isTelemetryEnabled()) return undefined as ReturnType<Sdk['init']>;
  void load().then((real) => {
    real.init(options);
    sdk = real;
    const pending = queue;
    queue = [];
    for (const call of pending) {
      try {
        call(real);
      } catch (err) {
        // A replayed telemetry call must never break the app; it is telemetry.
        silentCatch('sentryFacade:replay')(err);
      }
    }
    if (dropped > 0) real.addBreadcrumb({ category: 'sentry-facade', message: `${dropped} early call(s) dropped (queue full)`, level: 'warning' });
  });
  return undefined as ReturnType<Sdk['init']>;
}

export const addBreadcrumb: Sdk['addBreadcrumb'] = (...args) => run((s) => s.addBreadcrumb(...args));

export const captureMessage = ((...args: Parameters<Sdk['captureMessage']>) => {
  run((s) => {
    s.captureMessage(...args);
  });
  return '';
}) as Sdk['captureMessage'];

export const captureException = ((...args: Parameters<Sdk['captureException']>) => {
  run((s) => {
    s.captureException(...args);
  });
  return '';
}) as Sdk['captureException'];

export const setTag: Sdk['setTag'] = (...args) => run((s) => s.setTag(...args));

/** Before the SDK is up the callback runs later, on the real scope; nothing reads its return value. */
export const withScope = ((callback: (scope: SentryReact.Scope) => unknown) => {
  run((s) => {
    s.withScope(callback);
  });
}) as unknown as Sdk['withScope'];

export const metrics = new Proxy({} as Sdk['metrics'], {
  get: (_target, method: string) =>
    (...args: unknown[]) =>
      run((s) => (s.metrics as unknown as Record<string, (...a: unknown[]) => unknown>)[method]?.(...args)),
});

interface FallbackArgs {
  error: unknown;
  componentStack: string;
  eventId: string;
  resetError: () => void;
}
interface BoundaryOptions {
  fallback?: ReactNode | ((args: FallbackArgs) => ReactNode);
}
interface BoundaryState {
  error: unknown;
  componentStack: string;
}

/**
 * The app root's boundary, synchronous because it mounts before the SDK
 * exists. It renders `fallback` like Sentry's ErrorBoundary does and reports
 * the error through the queue above.
 */
export function withErrorBoundary<P extends object>(Wrapped: ComponentType<P>, options: BoundaryOptions): ComponentType<P> {
  class FacadeErrorBoundary extends Component<P, BoundaryState> {
    state: BoundaryState = { error: null, componentStack: '' };
    static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
      return { error };
    }
    componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
      const componentStack = info.componentStack ?? '';
      this.setState({ componentStack });
      captureException(error, { contexts: { react: { componentStack } } });
    }
    resetError = (): void => this.setState({ error: null, componentStack: '' });
    render(): ReactNode {
      const { error, componentStack } = this.state;
      if (error === null) return <Wrapped {...this.props} />;
      const { fallback } = options;
      return typeof fallback === 'function'
        ? fallback({ error, componentStack, eventId: '', resetError: this.resetError })
        : (fallback ?? null);
    }
  }
  return FacadeErrorBoundary;
}

/** Spec-only: drop all state so each case starts cold. */
export function __resetSentryFacadeForTests(): void {
  queue = [];
  dropped = 0;
  sdk = null;
  loading = null;
}
