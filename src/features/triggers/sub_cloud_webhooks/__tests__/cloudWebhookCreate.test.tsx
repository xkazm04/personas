/**
 * The cloud webhook "Deployed persona" picker offers deployed personas only,
 * and a refused create or delete says so.
 *
 * The picker used to list every persona WITHOUT a webhook row, so undeployed
 * personas were offered too. A webhook on one has no /api/deployed/{slug} URL,
 * and this tab reads triggers from active deployments only, so the trigger the
 * user just created never appeared. Create and delete failures went to
 * silentCatch: the button settled and nothing was said.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import csTriggers from '@/i18n/section-locales/cs/triggers.json';
import enCommon from '@/i18n/section-locales/en/common.json';
import enEmptyStates from '@/i18n/section-locales/en/empty_states.json';
import enShared from '@/i18n/section-locales/en/shared.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { triggers: csTriggers, common: enCommon, empty_states: enEmptyStates, shared: enShared },
    tx: (s: string) => s,
    language: 'cs',
  }),
}));

vi.mock('@/hooks/realtime/useCloudWebhookRelay', () => ({
  useCloudWebhookRelay: () => ({ connected: true, activeWebhookTriggers: 0, totalRelayed: 0, lastPollAt: null }),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: { id: string; name: string }[] }) => unknown) =>
    sel({
      personas: [
        { id: 'p-deployed', name: 'Deployed One' },
        { id: 'p-hooked', name: 'Already Hooked' },
        { id: 'p-local', name: 'Local Only' },
      ],
    }),
}));

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauriInvoke')>()),
  invokeWithTimeout: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

const toastCatch = vi.fn(() => () => {});
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (...a: unknown[]) => toastCatch(...a),
}));

const { CloudWebhooksTab } = await import('../CloudWebhooksTab');

const dep = (personaId: string, slug: string) => ({
  id: `d-${slug}`, projectId: 'pr', personaId, slug, label: slug, status: 'active',
  webhookEnabled: true, webhookSecret: null, invocationCount: 0n, lastInvokedAt: null,
});

describe('cloud webhook create', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastCatch.mockClear();
    invoke.mockImplementation((cmd: string, args?: { personaId?: string }) => {
      if (cmd === 'cloud_list_deployments') return Promise.resolve([dep('p-deployed', 'one'), dep('p-hooked', 'two')]);
      if (cmd === 'cloud_get_base_url') return Promise.resolve('https://cloud.example');
      if (cmd === 'cloud_list_triggers') {
        return Promise.resolve(args?.personaId === 'p-hooked'
          ? [{ id: 'tr1', personaId: 'p-hooked', triggerType: 'webhook', lastTriggeredAt: null }]
          : []);
      }
      if (cmd === 'cloud_create_trigger') return Promise.reject({ error: 'Cloud error: 409 conflict', kind: 'cloud' });
      return Promise.resolve(null);
    });
  });

  it('offers only deployed personas without a webhook, and a refused create is surfaced', async () => {
    render(<CloudWebhooksTab />);
    await screen.findByText('Already Hooked');
    fireEvent.click(screen.getByRole('button', { name: csTriggers.add_webhook }));
    const select = screen.getByRole('combobox');
    const names = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('Deployed One');
    expect(names).not.toContain('Local Only');
    expect(names).not.toContain('Already Hooked');

    fireEvent.change(select, { target: { value: 'p-deployed' } });
    fireEvent.click(screen.getByRole('button', { name: csTriggers.create_webhook }));
    await waitFor(() =>
      expect(toastCatch).toHaveBeenCalledWith('features/triggers/sub_cloud_webhooks/CloudWebhooksTab:create'),
    );
  });
});
