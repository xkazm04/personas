/**
 * The build resolves every app import of `@sentry/react` to sentryFacade.tsx
 * (vite.config.ts, `sentry-deferred`), so this is what production calls. It
 * must lose nothing that happens before the SDK is up, fetch nothing while
 * telemetry is off, and keep the root error boundary's behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const calls: string[] = [];
const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) => cb({ setTag: vi.fn() })),
  metrics: { count: vi.fn() },
}));
vi.mock('@sentry/react', () => sdk);

import * as facade from '../sentryFacade';

// init() imports the SDK module; under load that takes longer than a tick, so wait for it.
const sdkUp = () => vi.waitFor(() => expect(sdk.init).toHaveBeenCalled());
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  facade.__resetSentryFacadeForTests();
  calls.length = 0;
  for (const fn of [sdk.init, sdk.addBreadcrumb, sdk.captureException, sdk.captureMessage, sdk.setTag, sdk.metrics.count]) fn.mockClear();
  sdk.init.mockImplementation(() => calls.push('init'));
  sdk.addBreadcrumb.mockImplementation(() => calls.push('breadcrumb'));
  sdk.captureException.mockImplementation(() => calls.push('exception'));
});
afterEach(() => facade.__resetSentryFacadeForTests());

describe('sentryFacade', () => {
  it('queues calls made before init and replays them, in order, after init', async () => {
    facade.addBreadcrumb({ message: 'boot' });
    facade.captureException(new Error('early'));
    expect(sdk.addBreadcrumb).not.toHaveBeenCalled();

    facade.init({ dsn: undefined });
    await sdkUp();

    expect(calls).toEqual(['init', 'breadcrumb', 'exception']);
    expect(sdk.captureException).toHaveBeenCalledWith(new Error('early'));
  });

  it('calls straight through once the SDK is up', async () => {
    facade.init({});
    await sdkUp();
    facade.captureMessage('later', 'info');
    expect(sdk.captureMessage).toHaveBeenCalledWith('later', 'info');
  });

  it('never initialises the SDK while telemetry is off (no init call)', async () => {
    facade.captureException(new Error('dropped'));
    await settle();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('honours a withdrawn consent: no init, and calls after it are dropped', async () => {
    facade.init({});
    await sdkUp();
    localStorage.setItem('__personas_telemetry_enabled', 'false');
    try {
      facade.captureException(new Error('after withdrawal'));
      expect(sdk.captureException).not.toHaveBeenCalled();
      facade.__resetSentryFacadeForTests();
      sdk.init.mockClear();
      facade.init({});
      await settle();
      expect(sdk.init).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem('__personas_telemetry_enabled');
    }
  });

  it('forwards metrics and scopes through the queue', async () => {
    facade.metrics.count('onboarding.templates.load', 1);
    facade.withScope((scope) => scope.setTag('k', 'v'));
    facade.init({});
    await sdkUp();
    expect(sdk.metrics.count).toHaveBeenCalledWith('onboarding.templates.load', 1);
    expect(sdk.withScope).toHaveBeenCalledTimes(1);
  });

  it('renders the fallback for a render error, reports it, and resets', async () => {
    let explode = true;
    const Boom = () => {
      if (explode) throw new Error('render failed');
      return <p>recovered</p>;
    };
    const Wrapped = facade.withErrorBoundary(Boom, {
      fallback: ({ error, resetError }) => (
        <button type="button" onClick={resetError}>{(error as Error).message}</button>
      ),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Wrapped />);
    spy.mockRestore();

    expect(screen.getByRole('button', { name: 'render failed' })).toBeTruthy();
    facade.init({});
    await sdkUp();
    expect(sdk.captureException).toHaveBeenCalledTimes(1);

    explode = false;
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
