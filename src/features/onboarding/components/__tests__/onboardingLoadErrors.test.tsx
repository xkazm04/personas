import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// The IPC layer rejects with a serialized AppError OBJECT, never an Error.
const appError = { error: 'database is locked', kind: 'Database' };

vi.mock('@/api/overview/reviews', () => ({
  getTrendingTemplates: () => Promise.reject(appError),
  listDesignReviews: () => Promise.reject(appError),
}));
vi.mock('@/api/system/desktop', () => ({
  discoverDesktopApps: () => Promise.reject(appError),
  getDesktopConnectorManifest: vi.fn(),
  approveDesktopCapabilities: vi.fn(),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { useSystemStore } from '@/stores/systemStore';
import { useOnboardingState } from '../useOnboardingState';
import { TemplatePickerStep } from '../TemplatePickerStep';
import { DesktopDiscoveryStep } from '../DesktopDiscoveryStep';

describe('onboarding load failures from IPC render as words, not [object Object]', () => {
  beforeEach(() => {
    useSystemStore.setState({ onboardingActive: true });
  });

  it('template list and desktop scan both fail with an AppError object', async () => {
    const { result } = renderHook(() => useOnboardingState());
    await waitFor(() => expect(result.current.templateLoadState.phase).toBe('error'));
    await waitFor(() => expect(result.current.discoveryState.phase).toBe('error'));

    const picker = render(
      <TemplatePickerStep
        templates={[]}
        loadState={result.current.templateLoadState}
        selectedId={null}
        approvedApps={new Set()}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(picker.container.textContent).toContain(en.onboarding.templates_load_error);
    expect(picker.container.textContent).not.toContain('[object Object]');
    picker.unmount();

    const discovery = render(
      <DesktopDiscoveryStep
        apps={[]}
        scanState={result.current.discoveryState}
        approvedApps={new Set()}
        approvingApp={null}
        onApprove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(discovery.container.textContent).toContain(en.onboarding.desktop_scan_error);
    expect(discovery.container.textContent).not.toContain('[object Object]');
  });
});
