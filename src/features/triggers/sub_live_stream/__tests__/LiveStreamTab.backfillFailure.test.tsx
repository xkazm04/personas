/**
 * Unread history is not a quiet bus. A failed backfill was only logged, so the
 * grid said "No events on the bus" to someone checking why an agent did not run,
 * and nothing on the tab could read the history again. The failure is now stated
 * and retryable while the live listener keeps delivering.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import enCommon from '@/i18n/section-locales/en/common.json';
import enTriggers from '@/i18n/section-locales/en/triggers.json';
import type { PersonaEvent } from '@/lib/types/types';

const listEvents = vi.hoisted(() => vi.fn());
const bus = vi.hoisted(() => ({ deliver: null as null | ((evt: unknown) => void) }));

vi.mock('@/api/overview/events', () => ({ listEvents: (...a: unknown[]) => listEvents(...a) }));
vi.mock('@/hooks/realtime/useEventBusListener', () => ({
  useEventBusListener: (cb: (evt: unknown) => void) => {
    bus.deliver = cb;
    return true;
  },
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (select: (s: { personas: never[] }) => unknown) => select({ personas: [] }),
}));

import { LiveStreamTab } from '../LiveStreamTab';

const event = (id: string, event_type: string): PersonaEvent => ({
  id, project_id: 'proj-1', event_type, source_type: 'smee_relay',
  source_id: null, target_persona_id: null, payload: null, status: 'delivered',
  error_message: null, processed_at: null, created_at: new Date().toISOString(),
  use_case_id: null, retry_count: 0,
});

const REJECTION = { error: 'Event table is locked', kind: 'Database' };

const findBanner = async () => {
  await screen.findByText(enTriggers.could_not_load_history);
  return screen.getByRole('alert');
};
const expectNoQuietBusClaim = () => {
  expect(screen.queryByText(enTriggers.no_events_title)).toBeNull();
  expect(screen.queryByText(enTriggers.no_events_desc)).toBeNull();
};
/** The tab batches bus deliveries into one animation frame. */
const deliver = async (evt: PersonaEvent) => {
  await act(async () => {
    bus.deliver!(evt);
    await new Promise((r) => setTimeout(r, 50));
  });
};

describe('LiveStreamTab failed backfill', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    bus.deliver = null;
    listEvents.mockReset();
  });

  it('states the failure instead of an empty bus', async () => {
    listEvents.mockRejectedValue(REJECTION);
    render(<LiveStreamTab />);

    const banner = await findBanner();
    expect(within(banner).getByRole('button', { name: enCommon.retry })).toBeInTheDocument();
    expectNoQuietBusClaim();
  });

  it('Retry re-reads the history; success clears the banner and shows the rows', async () => {
    listEvents.mockRejectedValueOnce(REJECTION);
    render(<LiveStreamTab />);
    const banner = await findBanner();
    expect(listEvents).toHaveBeenCalledTimes(1);

    listEvents.mockResolvedValueOnce([event('e1', 'github_push')]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('github_push')).toBeInTheDocument();
    expect(screen.queryByText(enTriggers.could_not_load_history)).toBeNull();
  });

  it('a Retry that succeeds with no events ends on the true empty state', async () => {
    listEvents.mockRejectedValueOnce(REJECTION);
    render(<LiveStreamTab />);
    const banner = await findBanner();

    listEvents.mockResolvedValueOnce([]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    expect(await screen.findByText(enTriggers.no_events_title)).toBeInTheDocument();
    expect(screen.queryByText(enTriggers.could_not_load_history)).toBeNull();
  });

  it('a Retry that fails again keeps the failure stated', async () => {
    listEvents.mockRejectedValue(REJECTION);
    render(<LiveStreamTab />);
    const banner = await findBanner();

    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
    await findBanner();
    expectNoQuietBusClaim();
  });

  it('a live event arriving during the failure is still listed, and the failure still stands', async () => {
    listEvents.mockRejectedValue(REJECTION);
    render(<LiveStreamTab />);
    await findBanner();

    await deliver(event('live-1', 'deal_won'));

    expect(await screen.findByText('deal_won')).toBeInTheDocument();
    await findBanner();
  });

  it('a successful Retry keeps the live rows that arrived during the failure', async () => {
    listEvents.mockRejectedValueOnce(REJECTION);
    render(<LiveStreamTab />);
    const banner = await findBanner();
    await deliver(event('live-1', 'deal_won'));
    await screen.findByText('deal_won');

    listEvents.mockResolvedValueOnce([event('old-1', 'github_push')]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    expect(await screen.findByText('github_push')).toBeInTheDocument();
    expect(screen.getByText('deal_won')).toBeInTheDocument();
    expect(screen.queryByText(enTriggers.could_not_load_history)).toBeNull();
  });

  it('a successful empty read keeps the quiet-bus copy and no banner', async () => {
    listEvents.mockResolvedValue([]);
    render(<LiveStreamTab />);

    expect(await screen.findByText(enTriggers.no_events_title)).toBeInTheDocument();
    expect(screen.queryByText(enTriggers.could_not_load_history)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
