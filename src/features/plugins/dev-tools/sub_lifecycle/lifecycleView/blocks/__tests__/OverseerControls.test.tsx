import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

// The Lifecycle header's Overseer hand-off against a stubbed API: a send says
// what it filed inline, a failed send says so in a Banner (never a toast), the
// star reflects what the backend returned, and a watched project with the
// Overseer off says auto-measure waits for him.

const setLifecycleWatch = vi.hoisted(() => vi.fn());
const sendLifecycleToOverseer = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
const overseer = vi.hoisted(() => ({ enabled: true }));

vi.mock('@/api/devTools/lifecycle', () => ({ setLifecycleWatch, sendLifecycleToOverseer }));
vi.mock('@/features/companions/status/useCompanionsStatus', () => ({
  useCompanionsStatus: () => ({
    byId: (id: string) => (id === 'overseer' ? { id, enabled: overseer.enabled, eligible: true } : null),
  }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }), {
    getState: () => ({ addToast }),
  }),
}));
// New keys reach the section chunks only after the i18n split runs, so the
// component reads the English catalog directly here.
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import { OverseerControls } from '../OverseerControls';

const dl = en.plugins.dev_lifecycle;

beforeEach(() => {
  vi.clearAllMocks();
  overseer.enabled = true;
});

describe('OverseerControls', () => {
  it('says what a send filed, inline', async () => {
    sendLifecycleToOverseer.mockResolvedValue({ goalId: 'g1', filed: 3, alreadyOpen: 2 });
    render(<OverseerControls projectId="p1" watched={false} goal={null} />);

    fireEvent.click(screen.getByTestId('lc-overseer-send'));

    const line = screen.getByTestId('lc-overseer-result');
    await waitFor(() => expect(line.textContent).toBe('Sent: 3 new items, 2 already open'));
    expect(sendLifecycleToOverseer).toHaveBeenCalledWith('p1');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('shows a failed send in an inline Banner, not a toast', async () => {
    sendLifecycleToOverseer.mockRejectedValue(new Error('backend exploded'));
    render(<OverseerControls projectId="p1" watched={false} goal={null} />);

    fireEvent.click(screen.getByTestId('lc-overseer-send'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('lc-overseer-result').textContent).toBe('');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('stars the project and reflects the state the backend returned', async () => {
    setLifecycleWatch.mockResolvedValue(true);
    render(<OverseerControls projectId="p1" watched={false} goal={null} />);
    const star = screen.getByTestId('lc-overseer-star');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.getAttribute('aria-label')).toBe(dl.lc_ov_watch);

    fireEvent.click(star);

    expect(setLifecycleWatch).toHaveBeenCalledWith('p1', true);
    await waitFor(() => expect(screen.getByTestId('lc-overseer-star').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByTestId('lc-overseer-star').getAttribute('aria-label')).toBe(dl.lc_ov_unwatch);
  });

  it('hints that auto-measure needs the Overseer on when he is off', () => {
    overseer.enabled = false;
    render(<OverseerControls projectId="p1" watched goal={null} />);
    expect(screen.getByTestId('lc-overseer-off-hint').textContent).toBe(dl.lc_ov_off_hint);
  });

  it('gives no off hint while the Overseer is on', () => {
    render(<OverseerControls projectId="p1" watched goal={null} />);
    expect(screen.queryByTestId('lc-overseer-off-hint')).toBeNull();
  });

  it('offers to send again once a goal exists', () => {
    const goal = { goalId: 'g1', measurableTotal: 5, measurableGreen: 2, instructed: 1, openItems: 3 };
    render(<OverseerControls projectId="p1" watched goal={goal} />);
    expect(screen.getByTestId('lc-overseer-send').textContent).toContain(dl.lc_ov_resend);
  });
});
