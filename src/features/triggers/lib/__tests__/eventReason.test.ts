import { describe, it, expect } from 'vitest';
import {
  EVENT_REASON_TOKENS,
  classifyEventReason,
  parseEventReasonTokens,
  reasonIsExpectedFor,
} from '../eventReason';

describe('parseEventReasonTokens', () => {
  it('accepts every token the Rust bus can emit', () => {
    for (const token of EVENT_REASON_TOKENS) {
      expect(parseEventReasonTokens(token)).toEqual([token]);
    }
  });

  it('splits a comma-joined multi-gate ledger', () => {
    expect(parseEventReasonTokens('persona_disabled,cascade_guard')).toEqual([
      'persona_disabled',
      'cascade_guard',
    ]);
  });

  it('tolerates whitespace around separators', () => {
    expect(parseEventReasonTokens(' dry_run , cascade_guard ')).toEqual([
      'dry_run',
      'cascade_guard',
    ]);
  });

  it('rejects free-form failure text so it renders verbatim', () => {
    expect(parseEventReasonTokens('One or more subscription executions failed')).toBeNull();
    // Legacy prose the bus used to write for a stalled handoff.
    expect(
      parseEventReasonTokens('handoff dropped: target persona disabled — cascade stalled here'),
    ).toBeNull();
  });

  it('rejects a partially-known list rather than half-labelling it', () => {
    expect(parseEventReasonTokens('cascade_guard,boom at line 4')).toBeNull();
  });

  it('treats empty / null / blank as no reason', () => {
    expect(parseEventReasonTokens(null)).toBeNull();
    expect(parseEventReasonTokens(undefined)).toBeNull();
    expect(parseEventReasonTokens('')).toBeNull();
    expect(parseEventReasonTokens('   ')).toBeNull();
    expect(parseEventReasonTokens(',,')).toBeNull();
  });
});

describe('reasonIsExpectedFor', () => {
  it('expects a reason on statuses that ended without delivering', () => {
    expect(reasonIsExpectedFor('skipped')).toBe(true);
    expect(reasonIsExpectedFor('failed')).toBe(true);
    expect(reasonIsExpectedFor('dead_letter')).toBe(true);
  });

  it('does not expect one on healthy or in-flight statuses', () => {
    expect(reasonIsExpectedFor('delivered')).toBe(false);
    expect(reasonIsExpectedFor('completed')).toBe(false);
    expect(reasonIsExpectedFor('pending')).toBe(false);
    expect(reasonIsExpectedFor('processing')).toBe(false);
  });
});

describe('classifyEventReason', () => {
  it('labels recorded gate tokens', () => {
    expect(classifyEventReason({ status: 'skipped', error_message: 'no_subscriber' })).toEqual({
      kind: 'tokens',
      tokens: ['no_subscriber'],
    });
  });

  it('renders genuine failure text verbatim', () => {
    expect(classifyEventReason({ status: 'failed', error_message: 'connection refused' })).toEqual({
      kind: 'text',
      text: 'connection refused',
    });
  });

  it('reports pre-ledger skipped rows as unknown, never a fabricated reason', () => {
    // The 22 rows measured on the live DB: status 'skipped', error_message NULL.
    expect(classifyEventReason({ status: 'skipped', error_message: null })).toEqual({
      kind: 'unknown',
    });
  });

  it('says nothing about an event that dispatched cleanly', () => {
    expect(classifyEventReason({ status: 'delivered', error_message: null })).toEqual({
      kind: 'none',
    });
  });

  it('still explains a delivered event whose fan-out was fully gated', () => {
    expect(
      classifyEventReason({ status: 'delivered', error_message: 'cascade_guard' }),
    ).toEqual({ kind: 'tokens', tokens: ['cascade_guard'] });
  });
});
