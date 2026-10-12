import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSubscription } from '@/lib/bindings/NotificationSubscription';

const api = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));

vi.mock('@/api/events/notificationSubscriptions', () => ({
  listNotificationSubscriptions: api.list,
  deleteNotificationSubscription: api.remove,
  createNotificationSubscription: vi.fn(),
  updateNotificationSubscription: vi.fn(),
  testNotificationSubscription: vi.fn(),
}));
vi.mock('@/api/overview/events', () => ({ listKnownEventTypes: vi.fn().mockResolvedValue([]) }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: { confirm: 'confirm' },
      settings: { notifications: new Proxy({}, { get: (_target, key) => String(key) }) },
    },
  }),
  interpolate: (value: string) => value,
}));

import { WebhookSubscriptionsPanel } from '../WebhookSubscriptionsPanel';

const subscription: NotificationSubscription = {
  id: 'sub-1', label: 'Alerts', provider: 'generic', webhookUrl: 'https://example.test/hook',
  credentialId: null, eventTypes: '["execution.finished"]', templateBody: null,
  enabled: true, lastDeliveryAt: null, lastDeliveryStatus: null, lastError: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([subscription]);
  api.remove.mockReset().mockResolvedValue(undefined);
});

describe('WebhookSubscriptionsPanel deletion', () => {
  it('requires a second click before deleting a subscription', async () => {
    render(<WebhookSubscriptionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'webhook_subscriptions_delete_aria' }));
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('sub-1'));
  });
});
