import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));
vi.mock('@/stores/themeStore', () => ({ useIsDarkTheme: () => true }));
vi.mock('@/lib/silentCatch', async (orig) => ({ ...(await orig<typeof import('@/lib/silentCatch')>()), silentCatch: () => () => {}, toastCatch: () => () => {} }));
vi.mock('./../PresetPreviewModal', () => ({ PresetPreviewModal: () => null }));
vi.mock('@/hooks/utility/interaction/useProgressiveReveal', () => ({
  useRevealTracker: () => ({ hasEntered: () => true, markEntered: () => {} }),
}));
vi.mock('@/features/shared/components/display/RevealItem', () => ({
  RevealItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/shared/components/feedback/ScenarioEmptyState', () => ({
  default: () => <div data-testid="empty-state" />,
}));

vi.mock('@/features/shared/components/feedback/InlineErrorBanner', () => ({
  InlineErrorBanner: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="load-error">{message}<button type="button" onClick={onRetry}>retry</button></div>
  ),
}));

const listTeamPresets = vi.fn();
vi.mock('@/api/templates/teamPresets', () => ({
  listTeamPresets: (...a: unknown[]) => listTeamPresets(...a),
}));

import PresetLibraryPage from '../PresetLibraryPage';

describe('PresetLibraryPage load failure', () => {
  beforeEach(() => listTeamPresets.mockReset());

  it('shows an error with retry, not the empty state, when the read rejects', async () => {
    listTeamPresets.mockRejectedValueOnce(new Error('disk read failed'));
    render(<PresetLibraryPage />);
    await waitFor(() => expect(listTeamPresets).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    expect(screen.queryByTestId('empty-state')).toBeNull();

    listTeamPresets.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(listTeamPresets).toHaveBeenCalledTimes(2);
  });
});
