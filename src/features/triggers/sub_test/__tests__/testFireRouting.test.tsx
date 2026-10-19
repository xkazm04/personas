/**
 * "Did anyone run?" must be answerable from the tab built to ask it.
 *
 * TestTab loaded listAllSubscriptions() to infer which event types a persona
 * EMITS and then ignored listeners at fire time, so a test fire reported only
 * the new event's id and status - proof the bus accepted a JSON blob.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { listenersForEventType, deliveryForListener, canonicalEventType, type ListenerRow } from '../testFireRouting';
import { TestFireListeners } from '../TestFireListeners';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

const sub = (over: Partial<PersonaEventSubscription>): PersonaEventSubscription => ({
  id: 's1',
  persona_id: 'p1',
  event_type: 'deal.won',
  source_filter: null,
  enabled: true,
  created_at: '',
  updated_at: '',
  use_case_id: null,
  ...over,
});

const noCatalog = () => false;

describe('listenersForEventType', () => {
  const subs = [
    sub({ id: 's1', persona_id: 'p1' }),
    sub({ id: 's2', persona_id: 'p2' }),
    sub({ id: 's3', persona_id: 'p3', event_type: 'deal.lost' }),
  ];

  it('lists every subscription for the selected type', () => {
    expect(listenersForEventType(subs, 'deal.won', noCatalog).map((r) => r.personaId)).toEqual(['p1', 'p2']);
  });

  it('lists nothing before a type is chosen', () => {
    expect(listenersForEventType(subs, null, noCatalog)).toEqual([]);
  });

  it('excludes catalog event types, which are not persona-to-persona routes', () => {
    expect(listenersForEventType(subs, 'deal.won', (et) => et === 'deal.won')).toEqual([]);
  });

  it('matches separator variants the way the bus does (canonical, not exact)', () => {
    // engine/src/bus.rs is_eligible compares canonical_event_type on both sides,
    // so a code-review.completed listener DOES receive a code_review.completed fire.
    const rows = listenersForEventType(
      [sub({ id: 's9', persona_id: 'p9', event_type: 'code-review.completed' })],
      'code_review.completed',
      noCatalog,
    );
    expect(rows.map((r) => r.personaId)).toEqual(['p9']);
  });

  it('keeps a disabled subscription visible - it is why nothing ran', () => {
    const rows = listenersForEventType([sub({ enabled: false })], 'deal.won', noCatalog);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });
});

describe('canonicalEventType (mirror of engine/src/bus.rs canonical_event_type)', () => {
  it.each([
    ['code_review.completed', 'code.review.completed'],
    ['code-review.completed', 'code.review.completed'],
    ['code.review.completed', 'code.review.completed'],
    ['ux_review.completed', 'ux.review.completed'],
    ['  Goal__Progress. ', 'goal.progress'],
    ['-lead', 'lead'],
  ])('%s -> %s', (raw, canonical) => {
    expect(canonicalEventType(raw)).toBe(canonical);
  });
});

describe('deliveryForListener', () => {
  const row = (over: Partial<ListenerRow> = {}): ListenerRow => ({
    subscriptionId: 's1',
    personaId: 'p1',
    enabled: true,
    sourceFilter: null,
    ...over,
  });

  it('reports the addressed listener as targeted', () => {
    expect(deliveryForListener(row(), 'p1')).toBe('targeted');
  });

  it('reports the others as not addressed', () => {
    expect(deliveryForListener(row({ personaId: 'p2' }), 'p1')).toBe('not-targeted');
  });

  it('never fabricates a delivery for a broadcast', () => {
    // A PersonaEvent with no target_persona_id carries no per-listener record.
    expect(deliveryForListener(row(), null)).toBe('unknown');
  });

  it('reports a source-filtered listener as not reached by a sourceless broadcast', () => {
    // A test fire publishes with source_id None; bus.rs source_filter_matches
    // returns false for a missing source, even for the '*' wildcard.
    expect(deliveryForListener(row({ sourceFilter: '*' }), null, null)).toBe('not-targeted');
    expect(deliveryForListener(row({ sourceFilter: 'crm' }), null, null)).toBe('not-targeted');
    expect(deliveryForListener(row({ sourceFilter: 'crm*' }), null, 'crm-sync')).toBe('unknown');
    expect(deliveryForListener(row({ sourceFilter: 'crm' }), null, 'other')).toBe('not-targeted');
  });

  it('reports a disabled subscription before anything else', () => {
    expect(deliveryForListener(row({ enabled: false }), 'p1')).toBe('disabled');
  });
});

describe('TestFireListeners', () => {
  // The header copy lives in the code-split triggers section: without the
  // preload the render races the chunk and the header reads ''.
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  const rows: ListenerRow[] = [
    { subscriptionId: 's1', personaId: 'p1', enabled: true, sourceFilter: null },
    { subscriptionId: 's2', personaId: 'p2', enabled: true, sourceFilter: 'crm' },
  ];
  const name = (id: string) => ({ p1: 'Closer', p2: 'Notifier' })[id] ?? id;

  it('names the listeners before any fire', () => {
    render(<TestFireListeners listeners={rows} personaName={name} targetPersonaId={null} fired={false} />);
    expect(screen.getByTestId('test-fire-listener-p1').textContent).toContain('Closer');
    expect(screen.getByTestId('test-fire-listener-p2').textContent).toContain('Notifier');
    // No outcome is claimed before the event is fired.
    expect(screen.getByTestId('test-fire-listener-p1').getAttribute('data-delivery')).toBe('pending');
  });

  it('marks the outcome per row once fired', () => {
    render(<TestFireListeners listeners={rows} personaName={name} targetPersonaId="p1" fired />);
    expect(screen.getByTestId('test-fire-listener-p1').getAttribute('data-delivery')).toBe('targeted');
    expect(screen.getByTestId('test-fire-listener-p2').getAttribute('data-delivery')).toBe('not-targeted');
  });

  it('marks a source-filtered listener not reached after a sourceless broadcast', () => {
    render(<TestFireListeners listeners={rows} personaName={name} targetPersonaId={null} sourceId={null} fired />);
    expect(screen.getByTestId('test-fire-listener-p1').getAttribute('data-delivery')).toBe('unknown');
    expect(screen.getByTestId('test-fire-listener-p2').getAttribute('data-delivery')).toBe('not-targeted');
  });

  it('says plainly that a fire will run nothing when nobody listens', () => {
    render(<TestFireListeners listeners={[]} personaName={name} targetPersonaId={null} fired={false} />);
    expect(screen.getByTestId('test-fire-listeners').textContent).toContain('0');
  });
});
