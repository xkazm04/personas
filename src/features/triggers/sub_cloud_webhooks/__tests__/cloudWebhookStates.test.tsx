/**
 * The cloud webhooks tab tells a failed list read from an empty one, and shows
 * a firing's status through the status-token registry instead of printing the
 * orchestrator's raw word.
 *
 * A rejected list fetch went to silentCatch and left rows [], so the empty
 * state claimed "no webhook triggers" about a list nobody could read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/realtime/useCloudWebhookRelay', () => ({
  useCloudWebhookRelay: () => ({ connected: true, activeWebhookTriggers: 0, totalRelayed: 0, lastPollAt: null }),
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

describe('cloud webhooks tab states', () => {
  beforeEach(() => invoke.mockReset());

  it('a failed list read is an error state, not "no webhook triggers"', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'cloud_list_deployments') return Promise.reject({ error: 'Cloud error: 503', kind: 'cloud' });
      return Promise.resolve(null);
    });
    render(<CloudWebhooksTab />);
    expect(await screen.findByText(enTriggers.webhooks_load_failed)).toBeTruthy();
    expect(screen.queryByText(enTriggers.no_webhook_triggers)).toBeNull();
  });

  it('prints a firing status through the status-token registry', async () => {
    invoke.mockImplementation((cmd: string, args?: { personaId?: string; triggerId?: string }) => {
      if (cmd === 'cloud_list_deployments') {
        return Promise.resolve([{
          id: 'd-pa', projectId: 'pr', personaId: 'pa', slug: 'pa', label: 'pa', status: 'active',
          webhookEnabled: true, webhookSecret: null, invocationCount: 0n, lastInvokedAt: null,
        }]);
      }
      if (cmd === 'cloud_get_base_url') return Promise.resolve('https://cloud.example');
      if (cmd === 'cloud_list_triggers') {
        return Promise.resolve([{ id: 'tr-pa', personaId: args?.personaId, triggerType: 'webhook', lastTriggeredAt: null }]);
      }
      if (cmd === 'cloud_list_trigger_firings') {
        return Promise.resolve([{
          id: 'f1', triggerId: 'tr-pa', personaId: null, executionId: null,
          status: 'completed', costUsd: null, durationMs: null, firedAt: null, resolvedAt: null,
        }]);
      }
      return Promise.resolve(null);
    });
    render(<CloudWebhooksTab />);
    fireEvent.click(await screen.findByText('Alpha'));
    expect(await screen.findByText(enStatusTokens.execution.completed)).toBeTruthy();
    expect(screen.queryByText('completed')).toBeNull();
  });
});
