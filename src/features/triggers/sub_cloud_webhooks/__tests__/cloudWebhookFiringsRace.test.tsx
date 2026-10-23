/**
 * Switching the selected webhook row quickly must not paint the previous
 * row's firings under the new one: the firings effect had no stale guard, so
 * whichever cloud_list_trigger_firings answered LAST won.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import csTriggers from '@/i18n/section-locales/cs/triggers.json';
import enCommon from '@/i18n/section-locales/en/common.json';
import enEmptyStates from '@/i18n/section-locales/en/empty_states.json';
import enShared from '@/i18n/section-locales/en/shared.json';
import enStatusTokens from '@/i18n/section-locales/en/status_tokens.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { triggers: csTriggers, common: enCommon, empty_states: enEmptyStates, shared: enShared, status_tokens: enStatusTokens },
    tx: (s: string) => s,
    language: 'cs',
  }),
}));

vi.mock('@/hooks/realtime/useCloudWebhookRelay', () => ({
  useCloudWebhookRelay: () => ({ connected: true, activeWebhookTriggers: 0, totalRelayed: 0, lastPollAt: null }),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: { id: string; name: string }[] }) => unknown) =>
    sel({ personas: [{ id: 'pa', name: 'Alpha' }, { id: 'pb', name: 'Beta' }] }),
}));

const slow: { resolve?: (v: unknown) => void } = {};
const invoke = vi.fn((cmd: string, args?: { personaId?: string; triggerId?: string }) => {
  if (cmd === 'cloud_list_deployments') {
    return Promise.resolve(['pa', 'pb'].map((p) => ({
      id: `d-${p}`, projectId: 'pr', personaId: p, slug: p, label: p, status: 'active',
      webhookEnabled: true, webhookSecret: null, invocationCount: 0n, lastInvokedAt: null,
    })));
  }
  if (cmd === 'cloud_get_base_url') return Promise.resolve('https://cloud.example');
  if (cmd === 'cloud_list_triggers') {
    return Promise.resolve([{ id: `tr-${args?.personaId}`, personaId: args?.personaId, triggerType: 'webhook', lastTriggeredAt: null }]);
  }
  if (cmd === 'cloud_list_trigger_firings') {
    const row = (status: string) => [{
      id: `f-${args?.triggerId}`, triggerId: args?.triggerId, personaId: null, executionId: null,
      status, costUsd: null, durationMs: null, firedAt: null, resolvedAt: null,
    }];
    if (args?.triggerId === 'tr-pa') return new Promise((r) => { slow.resolve = () => r(row('alpha-status')); });
    return Promise.resolve(row('beta-status'));
  }
  return Promise.resolve(null);
});
vi.mock('@/lib/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauriInvoke')>()),
  invokeWithTimeout: (cmd: string, args?: { personaId?: string; triggerId?: string }) => invoke(cmd, args),
}));

const { CloudWebhooksTab } = await import('../CloudWebhooksTab');

describe('cloud webhook firings', () => {
  it('a slower answer for the previously selected row does not replace the current row', async () => {
    render(<CloudWebhooksTab />);
    fireEvent.click(await screen.findByText('Alpha'));
    fireEvent.click(screen.getByText('Beta'));
    await screen.findByText('beta-status');
    slow.resolve?.(null);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('alpha-status')).toBeNull();
    expect(screen.getByText('beta-status')).toBeTruthy();
  });
});
