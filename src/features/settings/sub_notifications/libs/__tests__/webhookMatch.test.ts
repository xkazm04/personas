import { describe, it, expect } from 'vitest';
import {
  EMPTY_WEBHOOK_DRAFT,
  classifyPatterns,
  deliveryHealth,
  draftToPayload,
  parseEventTypes,
  previewMatches,
  type MatchableEvent,
} from '../webhookMatch';

const ev = (event_type: string, created_at = '2026-09-20T10:00:00Z'): MatchableEvent => ({
  event_type,
  created_at,
});

describe('previewMatches', () => {
  it('case 3: a dotted family does not cover the snake_case production type, and says so', () => {
    const preview = previewMatches(['execution.*'], [ev('execution_completed'), ev('execution.queued')]);
    expect(preview.count).toBe(1);
    expect(preview.byType).toEqual({ 'execution.queued': 1 });
    expect(preview.separatorMisses).toEqual([
      { pattern: 'execution.*', eventType: 'execution_completed' },
    ]);
  });

  it('case 4: counts, groups by type and reports the latest matched event', () => {
    const events = [
      ev('execution_completed', '2026-09-20T10:00:00Z'),
      ev('execution_completed', '2026-09-22T08:30:00Z'),
      ev('execution_completed', '2026-09-21T12:00:00Z'),
      ev('alert_fired', '2026-09-21T13:00:00Z'),
      ev('trigger_fired', '2026-09-23T09:00:00Z'),
      ev('persona_action', '2026-09-23T10:00:00Z'),
    ];
    const preview = previewMatches(['execution_completed', 'alert_fired'], events);
    expect(preview.count).toBe(4);
    expect(preview.byType).toEqual({ execution_completed: 3, alert_fired: 1 });
    expect(preview.lastAt).toBe('2026-09-22T08:30:00Z');
    expect(preview.lastType).toBe('execution_completed');
    expect(preview.empty).toBe(false);
  });

  it('case 7: no patterns is an empty preview; "*" matches every event', () => {
    const events = [ev('a'), ev('b'), ev('c.d'), ev('execution_completed'), ev('x.y.z')];
    expect(previewMatches([], events)).toMatchObject({ count: 0, empty: true });
    expect(previewMatches(['*'], events)).toMatchObject({ count: 5, empty: false });
  });
});

describe('classifyPatterns', () => {
  it('case 5: unknown without a near neighbour, unknown with a suggestion, and a live family', () => {
    const vocabulary = [
      { eventType: 'execution.finished', source: 'builtin' },
      { eventType: 'sla.breach.opened', source: 'builtin' },
      { eventType: 'alert_fired', source: 'observed' },
    ];
    const [healing, typo, sla] = classifyPatterns(
      ['healing.escalated', 'execution.finsihed', 'sla.*'],
      vocabulary,
    );
    expect(healing).toMatchObject({ pattern: 'healing.escalated', status: 'unknown', suggestion: null });
    expect(typo).toMatchObject({
      pattern: 'execution.finsihed',
      status: 'unknown',
      suggestion: 'execution.finished',
    });
    expect(sla).toMatchObject({ pattern: 'sla.*', status: 'family', matches: ['sla.breach.opened'] });
  });

  it('a dotted family that only has snake_case neighbours is unknown and points at one', () => {
    const [verdict] = classifyPatterns(['execution.*'], [
      { eventType: 'execution_completed', source: 'builtin' },
    ]);
    expect(verdict).toMatchObject({ status: 'unknown', suggestion: 'execution_completed' });
  });
});

describe('deliveryHealth', () => {
  it('case 6: a failed last delivery is an error with the verbatim message; never delivered is idle', () => {
    const t = '2026-09-23T10:00:00Z';
    expect(
      deliveryHealth({ enabled: true, lastDeliveryStatus: 'failed', lastError: 'HTTP 404', lastDeliveryAt: t }),
    ).toEqual({ tone: 'error', error: 'HTTP 404', at: t });
    expect(
      deliveryHealth({ enabled: true, lastDeliveryAt: null, lastDeliveryStatus: null, lastError: null }),
    ).toEqual({ tone: 'idle', neverDelivered: true });
    expect(
      deliveryHealth({ enabled: true, lastDeliveryStatus: 'success', lastError: null, lastDeliveryAt: t }),
    ).toEqual({ tone: 'ok', at: t });
  });
});

describe('draft contract', () => {
  it('case 8 [guard]: parseEventTypes splits on comma and newline, and the payload sends that string[]', () => {
    const raw = 'execution_completed, healing.*\nalert_fired';
    expect(parseEventTypes(raw)).toEqual(['execution_completed', 'healing.*', 'alert_fired']);
    const payload = draftToPayload({
      ...EMPTY_WEBHOOK_DRAFT,
      label: ' Ops ',
      webhookUrl: ' https://hooks.example/x ',
      eventTypes: raw,
    });
    expect(payload).toEqual({
      label: 'Ops',
      provider: 'slack',
      webhookUrl: 'https://hooks.example/x',
      credentialId: null,
      eventTypes: ['execution_completed', 'healing.*', 'alert_fired'],
      templateBody: null,
      enabled: true,
    });
  });

  it('coordinator revision: a new draft opens with no patterns (no dead default)', () => {
    expect(EMPTY_WEBHOOK_DRAFT.eventTypes).toBe('');
  });
});
