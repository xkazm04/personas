/**
 * The bus dispatches two kinds of listener: legacy subscriptions and
 * `event_listener` triggers, which is what Chain Studio creates. The Test tab read
 * only the first, so a correctly wired agent got "a fire will run nothing", and a
 * failed read landed in the same sentence.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import enTriggers from '@/i18n/section-locales/en/triggers.json';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { PersonaTrigger } from '@/lib/types/types';

const events = vi.hoisted(() => ({
  listKnownEventTypes: vi.fn(),
  listEvents: vi.fn(),
  listAllSubscriptions: vi.fn(),
  testEventFlow: vi.fn(),
}));
const triggers = vi.hoisted(() => ({ listAllTriggers: vi.fn() }));
vi.mock('@/api/overview/events', () => events);
vi.mock('@/api/pipeline/triggers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/pipeline/triggers')>()),
  listAllTriggers: (...a: unknown[]) => triggers.listAllTriggers(...a),
}));

import { TestTab } from '../TestTab';
import { TestFireListeners } from '../TestFireListeners';
import { listenersForEventType } from '../testFireRouting';
import { useAgentStore } from '@/stores/agentStore';

const sub = (over: Partial<PersonaEventSubscription>): PersonaEventSubscription => ({
  id: 's1', persona_id: 'p1', event_type: 'deal.won', source_filter: null, enabled: true,
  created_at: '', updated_at: '', use_case_id: null,
  ...over,
});

const trigger = (over: Partial<PersonaTrigger> & { listen?: string; filter?: string }): PersonaTrigger => {
  const { listen = 'deal.won', filter, ...rest } = over;
  return {
    id: 't1', persona_id: 'p2', trigger_type: 'event_listener',
    config: JSON.stringify({ listen_event_type: listen, ...(filter ? { source_filter: filter } : {}) }),
    enabled: true, status: 'active', last_triggered_at: null, next_trigger_at: null,
    trigger_version: 1, created_at: '', updated_at: '', use_case_id: null, responsibility_id: null,
    ...rest,
  } as PersonaTrigger;
};

const noCatalog = () => false;

describe('listenersForEventType with event_listener triggers', () => {
  it('adds a trigger-only listener, keyed by the trigger id', () => {
    expect(listenersForEventType([], 'deal.won', noCatalog, [trigger({})])).toEqual([
      { subscriptionId: 't1', personaId: 'p2', enabled: true, sourceFilter: null },
    ]);
  });

  it('matches the trigger on the canonical type, the way the bus does', () => {
    const rows = listenersForEventType([], 'code_review.completed', noCatalog, [
      trigger({ listen: 'code-review.completed' }),
    ]);
    expect(rows.map((r) => r.personaId)).toEqual(['p2']);
  });

  it('keeps a disabled trigger visible - it is why nothing ran', () => {
    const rows = listenersForEventType([], 'deal.won', noCatalog, [trigger({ enabled: false })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });

  it('carries the config source_filter', () => {
    const rows = listenersForEventType([], 'deal.won', noCatalog, [trigger({ filter: 'crm*' })]);
    expect(rows[0]!.sourceFilter).toBe('crm*');
  });

  it('lists a persona with both a subscription and a trigger once, as the subscription', () => {
    const rows = listenersForEventType(
      [sub({ id: 's7', persona_id: 'p2' })],
      'deal.won',
      noCatalog,
      [trigger({ persona_id: 'p2' })],
    );
    expect(rows.map((r) => r.subscriptionId)).toEqual(['s7']);
  });

  it('lists both kinds together when they are different personas', () => {
    const rows = listenersForEventType([sub({ persona_id: 'p1' })], 'deal.won', noCatalog, [trigger({ persona_id: 'p2' })]);
    expect(rows.map((r) => r.personaId).sort()).toEqual(['p1', 'p2']);
  });

  it('still lists a trigger on a catalog event type: the bus dispatches it', () => {
    // bus.rs ParsedTrigger::is_eligible has no catalog check. The catalog
    // exclusion belongs to the subscription read, not to a wired trigger.
    const rows = listenersForEventType([], 'deal.won', (et) => et === 'deal.won', [trigger({})]);
    expect(rows.map((r) => r.personaId)).toEqual(['p2']);
  });

  it('ignores another event type, another trigger kind, and an unreadable config', () => {
    const rows = listenersForEventType([], 'deal.won', noCatalog, [
      trigger({ id: 't2', listen: 'deal.lost' }),
      trigger({ id: 't3', trigger_type: 'webhook', config: JSON.stringify({ event_type: 'deal.won' }) }),
      trigger({ id: 't4', config: 'not json' }),
      trigger({ id: 't5', config: null }),
      trigger({ id: 't6', config: '{}' }),
    ]);
    expect(rows).toEqual([]);
  });

  it('lists nothing before a type is chosen', () => {
    expect(listenersForEventType([], null, noCatalog, [trigger({})])).toEqual([]);
  });
});

describe('TestFireListeners readFailed', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });
  const name = (id: string) => id;

  it('does not claim nobody listens when a read failed', () => {
    render(<TestFireListeners listeners={[]} personaName={name} targetPersonaId={null} fired={false} readFailed />);
    expect(screen.getByTestId('test-fire-listeners')).toBeInTheDocument();
    expect(screen.queryByText(enTriggers.test_listeners_none)).toBeNull();
  });

  it('still lists the rows it did read', () => {
    const rows = [{ subscriptionId: 't1', personaId: 'p2', enabled: true, sourceFilter: null }];
    render(<TestFireListeners listeners={rows} personaName={name} targetPersonaId={null} fired={false} readFailed />);
    expect(screen.getByTestId('test-fire-listener-p2')).toBeInTheDocument();
  });

  it('keeps the plain sentence when the reads succeeded', () => {
    render(<TestFireListeners listeners={[]} personaName={name} targetPersonaId={null} fired={false} readFailed={false} />);
    expect(screen.getByText(enTriggers.test_listeners_none)).toBeInTheDocument();
  });
});

describe('TestTab listener panel', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    useAgentStore.setState({
      personas: [{ id: 'p1', name: 'Closer' }, { id: 'p2', name: 'Notifier' }] as never,
    });
    events.listKnownEventTypes.mockReset().mockResolvedValue([{ eventType: 'deal.won' }]);
    // The newest event auto-picks p1 and deal.won, so the panel previews that type.
    events.listEvents.mockReset().mockResolvedValue([{
      id: 'e1', project_id: 'x', event_type: 'deal.won', source_type: 'persona', source_id: 'p1',
      target_persona_id: null, payload: '{}', status: 'completed', error_message: null,
      processed_at: null, created_at: '2026-10-01T10:00:00Z', use_case_id: null, retry_count: 0,
    }]);
    events.listAllSubscriptions.mockReset().mockResolvedValue([]);
    events.testEventFlow.mockReset();
    triggers.listAllTriggers.mockReset().mockResolvedValue([]);
  });

  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

  it('names a persona wired only through an event_listener trigger', async () => {
    triggers.listAllTriggers.mockResolvedValue([trigger({ persona_id: 'p2' })]);
    render(<TestTab />);

    const row = await screen.findByTestId('test-fire-listener-p2');
    expect(row).toHaveTextContent('Notifier');
    expect(screen.queryByText(enTriggers.test_listeners_none)).toBeNull();
  });

  it('lists a persona with both a subscription and a trigger once', async () => {
    events.listAllSubscriptions.mockResolvedValue([sub({ id: 's1', persona_id: 'p2' })]);
    triggers.listAllTriggers.mockResolvedValue([trigger({ persona_id: 'p2' })]);
    render(<TestTab />);

    await screen.findByTestId('test-fire-listener-p2');
    await settle();
    expect(screen.getAllByTestId('test-fire-listener-p2')).toHaveLength(1);
  });

  it.each([
    ['subscription', () => events.listAllSubscriptions.mockRejectedValue({ error: 'locked' })],
    ['trigger', () => triggers.listAllTriggers.mockRejectedValue({ error: 'locked' })],
    ['subscription and trigger', () => {
      events.listAllSubscriptions.mockRejectedValue({ error: 'locked' });
      triggers.listAllTriggers.mockRejectedValue({ error: 'locked' });
    }],
  ])('a failed %s read does not claim nobody listens', async (_name, arm) => {
    arm();
    render(<TestTab />);
    await screen.findByTestId('test-fire-listeners');
    await settle();

    expect(events.listAllSubscriptions).toHaveBeenCalled();
    expect(screen.queryByText(enTriggers.test_listeners_none)).toBeNull();
  });

  it('a failed subscription read still names the trigger listener it did read', async () => {
    events.listAllSubscriptions.mockRejectedValue({ error: 'locked' });
    triggers.listAllTriggers.mockResolvedValue([trigger({ persona_id: 'p2' })]);
    render(<TestTab />);

    expect(await screen.findByTestId('test-fire-listener-p2')).toHaveTextContent('Notifier');
    expect(screen.queryByText(enTriggers.test_listeners_none)).toBeNull();
  });

  it('keeps the plain sentence when both reads succeed and nobody listens', async () => {
    render(<TestTab />);
    await screen.findByTestId('test-fire-listeners');
    await settle();

    expect(screen.getByText(enTriggers.test_listeners_none)).toBeInTheDocument();
  });
});
