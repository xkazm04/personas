/**
 * The slice of `@sentry/react` the facade (sentryFacade.tsx) loads after
 * init. Named imports, so the bundler tree-shakes the SDK: a dynamic import of
 * the package namespace kept every export (replay, tracing, feedback, ...) and
 * added ~315 KB to the build (measured 2026-10-25). This and the facade are
 * the only modules the `sentry-deferred` plugin lets reach the real package.
 */
import { addBreadcrumb, captureException, captureMessage, init, metrics, setTag, withScope } from '@sentry/react';

export const sdk = { addBreadcrumb, captureException, captureMessage, init, metrics, setTag, withScope };
export type SentrySdk = typeof sdk;
