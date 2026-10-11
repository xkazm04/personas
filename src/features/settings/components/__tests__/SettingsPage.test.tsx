import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsTab } from '@/lib/types/types';

const state: { settingsTab: SettingsTab } = { settingsTab: 'network' };

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock('@/features/settings/sub_network/components/ExposureManager', () => ({
  default: () => <button data-testid="network-tab">Network control</button>,
}));
vi.mock('@/features/settings/sub_appearance/components/AppearanceSettings', () => ({
  default: () => <button data-testid="appearance-tab">Appearance control</button>,
}));

import SettingsPage from '../SettingsPage';

describe('SettingsPage inactive tabs', () => {
  it('removes the hidden tab from focus and the accessibility tree', async () => {
    state.settingsTab = 'network';
    const { rerender } = render(<SettingsPage />);
    await screen.findByTestId('network-tab');

    state.settingsTab = 'appearance';
    rerender(<SettingsPage />);
    await screen.findByTestId('appearance-tab');

    const hiddenTab = screen.getByTestId('network-tab').parentElement;
    expect(hiddenTab).toHaveAttribute('inert');
    expect(hiddenTab).toHaveAttribute('aria-hidden', 'true');
  });
});
