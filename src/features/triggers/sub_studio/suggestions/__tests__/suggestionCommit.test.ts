/**
 * Pins the ghost-cable accept contract: an accepted suggestion routes through
 * the EXISTING studioCommit mapping (event_listener on the target persona)
 * and is created DISABLED so the dry-run gate always runs before the route
 * can fire — nothing auto-commits in Self-Wiring Fabric v1.
 */
import { describe, it, expect } from 'vitest';
import type { AutomationSuggestion } from '@/lib/bindings/AutomationSuggestion';
import { suggestionToDraftLink, suggestionToTriggerInput } from '../suggestionCommit';

const suggestion = (over: Partial<AutomationSuggestion> = {}): AutomationSuggestion => ({
  id: 'sug-1',
  eventType: 'deploy_completed',
  personaId: 'p-target',
  status: 'proposed',
  occurrenceCount: 6,
  manualRunCount: 8,
  support: 0.75,
  windowSeconds: 600,
  lookbackDays: 30,
  evidence: [],
  committedTriggerId: null,
  firstSeenAt: '2026-07-01T10:00:00Z',
  lastSeenAt: '2026-07-28T10:00:00Z',
  decidedAt: null,
  createdAt: '2026-07-29T10:00:00Z',
  updatedAt: '2026-07-29T10:00:00Z',
  ...over,
});

describe('suggestionToTriggerInput', () => {
  it('maps to an event_listener trigger on the suggested persona', () => {
    const input = suggestionToTriggerInput(suggestion());
    expect(input.persona_id).toBe('p-target');
    expect(input.trigger_type).toBe('event_listener');
    expect(JSON.parse(input.config ?? '{}')).toEqual({
      listen_event_type: 'deploy_completed',
    });
  });

  it('creates the trigger DISABLED so dry-run gates arming', () => {
    expect(suggestionToTriggerInput(suggestion()).enabled).toBe(false);
  });

  it('produces the same shape the hand-wired form path would (modulo enabled)', () => {
    const input = suggestionToTriggerInput(suggestion({ eventType: 'scan_finished' }));
    expect(input).toEqual({
      persona_id: 'p-target',
      trigger_type: 'event_listener',
      config: JSON.stringify({ listen_event_type: 'scan_finished' }),
      enabled: false,
      use_case_id: null,
    });
  });
});

describe('suggestionToDraftLink', () => {
  it('fabricates the event_listener signal-source link', () => {
    const link = suggestionToDraftLink(suggestion());
    expect(link.source).toEqual({ kind: 'trigger', triggerType: 'event_listener' });
    expect(link.targetPersonaId).toBe('p-target');
    expect(link.condition).toBeNull();
  });
});
