import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const publishTeamAsPreset = vi.fn();
vi.mock('@/api/agents/personas', () => ({
  publishTeamAsPreset: (...args: unknown[]) => publishTeamAsPreset(...args),
}));
vi.mock('@/lib/analytics', () => ({
  getInstallId: () => 'install-1',
  markActivation: vi.fn(),
}));
const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  // toastCatch reaches the store through getState(); the component through a selector.
  useToastStore: Object.assign(
    (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { PublishPresetButton } from '../PublishPresetButton';

describe('PublishPresetButton', () => {
  beforeEach(() => {
    publishTeamAsPreset.mockReset();
    addToast.mockReset();
  });

  it('publishes once: a click after success does not post a second catalog entry', async () => {
    publishTeamAsPreset.mockResolvedValue({ slug: 'core-team' });
    render(<PublishPresetButton teamId="t1" />);
    const btn = screen.getByTestId('team-publish-preset-btn');

    fireEvent.click(btn);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.pipeline.preset.published, 'success'));
    // Let the success render (done=true) commit before the second press.
    await waitFor(() => expect(screen.getByTestId('team-publish-preset-btn').textContent).toContain(en.pipeline.preset.published_short));

    fireEvent.click(screen.getByTestId('team-publish-preset-btn'));
    await new Promise((r) => setTimeout(r, 0));
    expect(publishTeamAsPreset).toHaveBeenCalledTimes(1);
  });

  it('a failed publish stays retryable', async () => {
    publishTeamAsPreset.mockRejectedValueOnce({ error: 'catalog down', kind: 'Cloud' });
    publishTeamAsPreset.mockResolvedValueOnce({ slug: 'core-team' });
    render(<PublishPresetButton teamId="t1" />);

    fireEvent.click(screen.getByTestId('team-publish-preset-btn'));
    await waitFor(() => expect(publishTeamAsPreset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByTestId('team-publish-preset-btn') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-publish-preset-btn'));
    await waitFor(() => expect(publishTeamAsPreset).toHaveBeenCalledTimes(2));
  });
});
