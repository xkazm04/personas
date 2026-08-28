import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// The Bun preflight is the ONLY thing standing between "Build with Athena" and a
// scaffold that dies minutes in on a missing runtime. It used to collapse three
// outcomes into a boolean: a probe that REJECTED was recorded exactly like a
// probe that found Bun, so an unreadable check enabled the button. These pin the
// three answers apart.

const webbuildBunStatus = vi.fn();
vi.mock('@/api/webbuild', () => ({
  webbuildBunStatus: () => webbuildBunStatus(),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => vi.fn(),
  toastCatch: () => vi.fn(),
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: { retry: 'Retry' },
      studio: new Proxy({} as Record<string, string>, { get: (_, k) => String(k) }),
    },
    tx: (s: string) => s,
  }),
}));

const StudioVisionStart = (await import('../StudioVisionStart')).default;

const renderStart = () =>
  render(<StudioVisionStart onSubmit={vi.fn()} busy={false} error={null} />);

const submit = () => screen.getByTestId('studio-vision-submit') as HTMLButtonElement;

afterEach(() => {
  cleanup();
  webbuildBunStatus.mockReset();
});

describe('the Bun preflight tells present, absent and unknown apart', () => {
  it('shows install guidance and blocks the build when Bun is absent', async () => {
    webbuildBunStatus.mockResolvedValue(null);
    renderStart();

    await waitFor(() => expect(screen.getByTestId('studio-vision-bun-missing')).toBeTruthy());
    expect(submit().disabled).toBe(true);
  });

  it('says so — and blocks — when the probe could not run at all', async () => {
    // This is the regression: a rejected probe used to set bunMissing = false,
    // which is indistinguishable from "Bun found", and the button went live.
    webbuildBunStatus.mockRejectedValue(new Error('IPC unavailable'));
    renderStart();

    await waitFor(() => expect(screen.getByTestId('studio-vision-bun-unknown')).toBeTruthy());
    expect(screen.queryByTestId('studio-vision-bun-missing')).toBeNull();
    expect(submit().disabled).toBe(true);
  });

  it('offers a retry from unknown, and clears once the probe answers', async () => {
    webbuildBunStatus.mockRejectedValueOnce(new Error('IPC unavailable'));
    webbuildBunStatus.mockResolvedValue('/usr/local/bin/bun');
    renderStart();

    const retry = await screen.findByTestId('studio-vision-bun-retry');
    retry.click();

    await waitFor(() => expect(screen.queryByTestId('studio-vision-bun-unknown')).toBeNull());
    expect(screen.queryByTestId('studio-vision-bun-missing')).toBeNull();
    expect(webbuildBunStatus).toHaveBeenCalledTimes(2);
  });

  it('stays out of the way when Bun is there', async () => {
    webbuildBunStatus.mockResolvedValue('/usr/local/bin/bun');
    renderStart();

    await waitFor(() => expect(webbuildBunStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('studio-vision-bun-missing')).toBeNull();
    expect(screen.queryByTestId('studio-vision-bun-unknown')).toBeNull();
  });
});
