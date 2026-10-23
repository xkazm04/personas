// A cold settings tab must show the delayed header ghost, not the empty
// SuspenseFallback box (measured 298-338 ms of blank body on 11 of 13 tabs).
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (store: { settingsTab: string }) => unknown) => selector({ settingsTab: 'account' }),
}));
// A chunk that never lands, so the page stays on its fallback.
vi.mock('@/features/settings/sub_account/components/AccountSettings', () => new Promise(() => {}));

import SettingsPage from '../SettingsPage';

describe('SettingsPage tab fallback', () => {
  it('renders the 150ms-delayed ghost while a tab chunk is in flight', () => {
    const { container } = render(<SettingsPage />);
    const ghost = container.querySelector('[aria-hidden="true"][style*="animation-delay: 150ms"]');
    expect(ghost).not.toBeNull();
  });
});
