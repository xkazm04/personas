/**
 * DW-127: a clicked calendar entry leads somewhere.
 *
 * Every chip looks and behaves like a button, but the only mount of the
 * calendar passed neither of its optional callbacks, so a click did nothing and
 * said nothing. A person asking why a slot failed had to leave and hunt for the
 * agent by hand. A run-bound slot opens its run; anything else opens its agent.
 * Either way the overlay gets out of the way.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../libs/calendarHelpers';
import type { CronAgent } from '@/lib/bindings/CronAgent';

const links = vi.hoisted(() => ({
  openExecutionFromLink: vi.fn(() => true),
  openPersonaFromLink: vi.fn(() => Promise.resolve(true)),
}));
const calendar = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock('@/lib/deepLinks/navigationLinks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deepLinks/navigationLinks')>()),
  ...links,
}));
vi.mock('../../libs/useCronPreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../libs/useCronPreview')>()),
  useCalendarEvents: () => ({ events: calendar.events, loading: false }),
}));
vi.mock('@/hooks/utility/useElementVisible', () => ({
  useElementVisible: () => [{ current: null }, true],
}));
vi.mock('@/lib/eventRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/eventRegistry')>()),
  typedListen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('@/api/pipeline/scheduler', () => ({
  getSchedulerStatus: vi.fn(() => Promise.resolve({ running: true })),
  stopScheduler: vi.fn(() => Promise.resolve({ running: false })),
  startScheduler: vi.fn(() => Promise.resolve({ running: true })),
}));

const agent: CronAgent = {
  persona_id: 'persona-owner',
  persona_name: 'Owner',
  persona_icon: null,
  persona_color: null,
  persona_enabled: true,
  headless: false,
  trigger_id: 'trig-1',
  cron_expression: '0 * * * *',
  interval_seconds: null,
  timezone: 'UTC',
  trigger_enabled: true,
  last_triggered_at: null,
  next_trigger_at: null,
  description: '',
  recent_executions: 1n,
  recent_failures: 0n,
};

vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: unknown) => unknown) =>
    sel({ cronAgents: [agent], cronAgentsLoading: false, fetchCronAgents: () => Promise.resolve() }),
}));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import SchedulesOverlay from '../SchedulesOverlay';

/** Today, each at its own hour: a week cell draws at most three chips. */
function event(name: string, hour: number, kind: CalendarEvent['kind'], executionId?: string): CalendarEvent {
  const time = new Date();
  time.setHours(hour, 0, 0, 0);
  return {
    id: `ev-${name}`,
    agentId: `persona-${name}`,
    agentName: `Chip ${name}`,
    agentIcon: null,
    agentColor: null,
    triggerId: agent.trigger_id,
    time,
    kind,
    ...(executionId ? { executionId } : {}),
  } as CalendarEvent;
}

calendar.events = [
  event('success', 8, 'past-success', 'exec-success'),
  event('failure', 10, 'past-failure', 'exec-failure'),
  event('projected', 12, 'projected'),
  event('unknown', 14, 'past-unknown'),
];

async function clickChip(name: string) {
  render(<SchedulesOverlay />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Chip ${name}`) }));
}

const expectOverlayClosed = () =>
  waitFor(() => expect(useSystemStore.getState().headerOverlay).toBe('none'));

beforeAll(async () => {
  await preloadSectionsAsync('en', ['schedules']);
});

beforeEach(() => {
  links.openExecutionFromLink.mockClear();
  links.openPersonaFromLink.mockClear();
  useSystemStore.setState({ headerOverlay: 'schedules' });
});

describe('calendar chips navigate', () => {
  it('a past-success chip opens its run and closes the overlay', async () => {
    await clickChip('success');
    await waitFor(() => expect(links.openExecutionFromLink).toHaveBeenCalledWith('exec-success'));
    expect(links.openPersonaFromLink).not.toHaveBeenCalled();
    await expectOverlayClosed();
  });

  it('a past-failure chip opens its run and closes the overlay', async () => {
    await clickChip('failure');
    await waitFor(() => expect(links.openExecutionFromLink).toHaveBeenCalledWith('exec-failure'));
    expect(links.openPersonaFromLink).not.toHaveBeenCalled();
    await expectOverlayClosed();
  });

  it('a projected chip opens its agent and closes the overlay', async () => {
    await clickChip('projected');
    await waitFor(() => expect(links.openPersonaFromLink).toHaveBeenCalledWith('persona-projected'));
    expect(links.openExecutionFromLink).not.toHaveBeenCalled();
    await expectOverlayClosed();
  });

  it('a past-unknown chip opens its agent and closes the overlay', async () => {
    await clickChip('unknown');
    await waitFor(() => expect(links.openPersonaFromLink).toHaveBeenCalledWith('persona-unknown'));
    expect(links.openExecutionFromLink).not.toHaveBeenCalled();
    await expectOverlayClosed();
  });
});
