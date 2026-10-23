/**
 * A relay that is up but degraded (a deployment's trigger listing timed out or
 * failed) says so on the tab. CloudWebhookRelayStatus.error had no reader, so
 * the banner stayed on the green "active" dot while triggers silently went
 * unpolled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import enTriggers from '@/i18n/section-locales/en/triggers.json';
import enCommon from '@/i18n/section-locales/en/common.json';
import enEmptyStates from '@/i18n/section-locales/en/empty_states.json';
import enShared from '@/i18n/section-locales/en/shared.json';
import enStatusTokens from '@/i18n/section-locales/en/status_tokens.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      triggers: enTriggers, common: enCommon, empty_states: enEmptyStates,
      shared: enShared, status_tokens: enStatusTokens,
    },
    tx: (s: string) => s,
    language: 'en',
  }),
}));

const relayStatus = vi.hoisted(() => ({ connected: true, activeWebhookTriggers: 0, totalRelayed: 0, lastPollAt: null as string | null, error: null as string | null }));
vi.mock('@/hooks/realtime/useCloudWebhookRelay', () => ({
  useCloudWebhookRelay: () => relayStatus,
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: { id: string; name: string }[] }) => unknown) =>
    sel({ personas: [{ id: 'pa', name: 'Alpha' }] }),
}));

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauriInvoke')>()),
  invokeWithTimeout: (cmd: string, args?: unknown) => invoke(cmd, args),
}));


const { CloudWebhooksTab } = await import('../CloudWebhooksTab');

describe('cloud webhooks tab relay error', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue([]);
    relayStatus.error = null;
  });

  it('shows the relay status error beside the active banner', async () => {
    relayStatus.error = 'Could not list webhook triggers for 1 of 3 cloud deployments';
    render(<CloudWebhooksTab />);
    expect(await screen.findByText(relayStatus.error)).toBeTruthy();
  });

  it('shows no error row for a healthy relay', async () => {
    render(<CloudWebhooksTab />);
    expect(await screen.findByText(enTriggers.cloud_relay_active)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
