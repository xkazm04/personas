/**
 * A test fire the user pressed must say when it failed. The catch used to be
 * silentCatch: the button stopped pulsing and nothing on screen changed.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/overview/events', () => ({
  listKnownEventTypes: vi.fn(async () => [{ eventType: 'deal.won' }]),
  listEvents: vi.fn(async () => [
    {
      id: 'e1', project_id: 'x', event_type: 'deal.won', source_type: 'persona', source_id: 'p1',
      target_persona_id: null, payload: '{"a":1}', status: 'completed', error_message: null,
      processed_at: null, created_at: '2026-10-01T10:00:00Z', use_case_id: null, retry_count: 0,
    },
  ]),
  listAllSubscriptions: vi.fn(async () => []),
  testEventFlow: vi.fn(async () => {
    // invokeWithTimeout rejects with a serialized AppError object.
    throw { error: 'Test event flow exceeded 30 events/minute. Retry after 12s', kind: 'RateLimited' };
  }),
}));

import { TestTab } from '../TestTab';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';

describe('TestTab test fire failure', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useAgentStore.setState({
      // Only id + name are read by this tab; the rest of Persona is irrelevant here.
      personas: [{ id: 'p1', name: 'Closer' }] as never,
    });
  });

  it('tells the user the publish failed, with the backend reason', async () => {
    render(<TestTab />);
    const fire = await screen.findByRole('button', { name: /publish/i });
    await waitFor(() => expect((fire as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(fire);
    await waitFor(() => {
      const toast = useToastStore.getState().toasts.at(-1);
      expect(toast?.type).toBe('error');
      expect(toast?.message).toContain('Retry after 12s');
    });
  });
});
