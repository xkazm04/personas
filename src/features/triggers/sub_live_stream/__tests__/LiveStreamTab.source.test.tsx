/**
 * The Live Stream names an event's source through the same registry as the
 * Overview events table (eventSourceRegistry), so one persona_events row reads
 * the same on both surfaces instead of printing the raw `smee_relay` token.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PersonaEvent } from '@/lib/types/types';

const EVENT: PersonaEvent = {
  id: 'evt-1', project_id: 'proj-1', event_type: 'github_push', source_type: 'smee_relay',
  source_id: null, target_persona_id: null, payload: null, status: 'delivered',
  error_message: null, processed_at: null, created_at: '2026-10-19T12:00:00Z',
  use_case_id: null, retry_count: 0,
};

vi.mock('@/api/overview/events', () => ({ listEvents: vi.fn(async () => [EVENT]) }));
vi.mock('@/hooks/realtime/useEventBusListener', () => ({ useEventBusListener: () => true }));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (select: (s: { personas: never[] }) => unknown) => select({ personas: [] }),
}));
vi.mock('@/i18n/useTranslation', async () => {
  const { default: t } = await import('@/i18n/locales/en.json');
  return { useTranslation: () => ({ t, tx: (s: string) => s, language: 'en' }) };
});

import { LiveStreamTab } from '../LiveStreamTab';

describe('LiveStreamTab source column', () => {
  it('labels a relayed webhook through the event-source registry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 19, 13)));
    try {
      render(<LiveStreamTab />);
      await waitFor(() => expect(screen.getByText('Webhook relay')).toBeInTheDocument());
      expect(screen.queryByText('smee_relay')).toBeNull();
      expect(screen.getByText('Delivered')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
