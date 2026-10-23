/**
 * The tray's row chrome used to carry English that no locale could reach: a
 * literal aria-label="Dismiss" on both row kinds, and a hand-rolled timestamp
 * ladder ("5m ago", "yesterday") frozen at the tray's last render. Both now go
 * through the catalog / the shared locale-aware RelativeTime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// The catalog sections the tray reads, with `common.dismiss` swapped for a
// marker so a literal that bypasses `t` cannot pass as the translated string.
vi.mock('@/i18n/useTranslation', async () => {
  const common = (await import('@/i18n/section-locales/en/common.json')).default;
  const gitlab = (await import('@/i18n/section-locales/en/gitlab.json')).default;
  return {
    // INVARIANT for the cast: these JSON files are what the generated proxy is
    // built from, so the shape matches for every key the tray reads.
    useTranslation: () => ({
      t: { common: { ...common, dismiss: 'cs-dismiss' }, gitlab } as never,
      tx: (s: string) => s,
      language: 'en',
    }),
  };
});

const systemState = {
  headerOverlay: 'notifications',
  setHeaderOverlay: vi.fn(),
  setSidebarSection: vi.fn(),
  setPluginTab: vi.fn(),
  setDevToolsTab: vi.fn(),
  gitlabTriggerPipelineAction: vi.fn(),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof systemState) => unknown) => selector(systemState),
}));
vi.mock('@/features/companions/athena/athenaStore', () => ({
  useAthenaStore: { getState: () => ({ setPendingPrompt: vi.fn(), setState: vi.fn() }) },
}));
vi.mock('@/features/vault/sub_credentials/components/card/attention/useConnectorAttention', () => ({
  useConnectorAttention: () => [],
}));
vi.mock('../ConnectorAttentionSection', () => ({ ConnectorAttentionSection: () => null }));
vi.mock('@/features/plugins/gitlab/components/pipelineHelpers', () => ({ StatusIcon: () => null }));
vi.mock('@/lib/notifications/notifyProcessComplete', () => ({ getProcessLabel: () => 'process' }));

import { NotificationCenter } from '../NotificationCenter';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { formatRelativeTime } from '@/lib/utils/formatters';

describe('NotificationCenter row chrome is translated', () => {
  beforeEach(() => {
    const ts = Date.now() - 5 * 60_000;
    useNotificationCenterStore.setState({
      notifications: [
        { id: 'proc-1', pipelineId: 0, projectId: null, status: 'success', ref: 'execution', webUrl: '', timestamp: ts, read: false, title: 'Run done', message: 'ok' },
        { id: 'gl-1', pipelineId: 42, projectId: 7, status: 'failed', ref: 'main', webUrl: '', timestamp: ts, read: true },
      ],
    } as never);
  });

  it('names the dismiss buttons through the catalog', () => {
    render(<NotificationCenter />);
    expect(screen.queryAllByLabelText('Dismiss')).toHaveLength(0);
    expect(screen.getAllByLabelText('cs-dismiss')).toHaveLength(2);
  });

  it('renders timestamps through the locale-aware formatter, not the English ladder', () => {
    render(<NotificationCenter />);
    expect(screen.queryAllByText('5m ago')).toHaveLength(0);
    const expected = formatRelativeTime(new Date(Date.now() - 5 * 60_000).toISOString());
    expect(screen.getAllByText(expected)).toHaveLength(2);
  });
});
