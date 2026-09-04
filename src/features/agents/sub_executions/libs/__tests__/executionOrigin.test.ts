import { describe, it, expect } from 'vitest';
import {
  deriveExecutionOrigin,
  parseAttentionMeta,
} from '../executionOrigin';

const attentionInput = JSON.stringify({
  source: 'attention',
  _attention: { ledgerId: 'att_1', responsibilityId: 'resp_1', lane: 'scan' },
  task: 'look around',
});

describe('deriveExecutionOrigin', () => {
  it('classifies all five origins from raw fields', () => {
    expect(deriveExecutionOrigin({ input_data: attentionInput })).toEqual({
      origin: 'attention',
      lane: 'scan',
    });
    expect(
      deriveExecutionOrigin({ input_data: JSON.stringify({ source: 'slack', text: 'hi' }) }),
    ).toEqual({ origin: 'channel', lane: null });
    expect(deriveExecutionOrigin({ trigger_id: 'trg-1' })).toEqual({
      origin: 'scheduled',
      lane: null,
    });
    expect(deriveExecutionOrigin({ is_simulation: true })).toEqual({
      origin: 'simulation',
      lane: null,
    });
    expect(deriveExecutionOrigin({})).toEqual({ origin: 'manual', lane: null });
  });

  it('classifies every channel source', () => {
    for (const source of ['channel', 'slack', 'discord', 'team_deliberation']) {
      expect(deriveExecutionOrigin({ input_data: JSON.stringify({ source }) }).origin).toBe(
        'channel',
      );
    }
  });

  it('applies precedence: attention > channel > scheduled > simulation', () => {
    // Attention envelope outranks a set trigger_id AND the simulation flag.
    expect(
      deriveExecutionOrigin({
        input_data: attentionInput,
        trigger_id: 'trg-1',
        is_simulation: true,
      }),
    ).toEqual({ origin: 'attention', lane: 'scan' });
    // Channel source outranks trigger_id and simulation.
    expect(
      deriveExecutionOrigin({
        input_data: JSON.stringify({ source: 'team_deliberation' }),
        trigger_id: 'trg-1',
        is_simulation: true,
      }).origin,
    ).toBe('channel');
    // trigger_id outranks the simulation flag.
    expect(
      deriveExecutionOrigin({ trigger_id: 'trg-1', is_simulation: true }).origin,
    ).toBe('scheduled');
  });

  it('recognizes an _attention block even without a source field', () => {
    expect(
      deriveExecutionOrigin({
        input_data: JSON.stringify({ _attention: { lane: 'improve' } }),
      }),
    ).toEqual({ origin: 'attention', lane: 'improve' });
  });

  it('treats malformed input_data as manual (or scheduled when trigger set)', () => {
    expect(deriveExecutionOrigin({ input_data: 'not json at all' }).origin).toBe('manual');
    expect(
      deriveExecutionOrigin({ input_data: 'not json', trigger_id: 'trg-1' }).origin,
    ).toBe('scheduled');
  });

  it('prefers the server-derived origin when present', () => {
    // List rows carry the SQL-derived fields; raw fields are absent there.
    expect(
      deriveExecutionOrigin({ origin: 'attention', origin_lane: 'scan' }),
    ).toEqual({ origin: 'attention', lane: 'scan' });
    // An unknown server value falls through to raw derivation, not a crash.
    expect(deriveExecutionOrigin({ origin: 'weird', is_simulation: true }).origin).toBe(
      'simulation',
    );
  });
});

describe('parseAttentionMeta', () => {
  it('extracts the provenance triple', () => {
    expect(parseAttentionMeta(attentionInput)).toEqual({
      ledgerId: 'att_1',
      responsibilityId: 'resp_1',
      lane: 'scan',
    });
  });

  it('degrades missing fields to null', () => {
    expect(
      parseAttentionMeta(JSON.stringify({ _attention: { lane: 'scan' } })),
    ).toEqual({ ledgerId: null, responsibilityId: null, lane: 'scan' });
  });

  it('returns null for absent, non-JSON, or non-attention payloads', () => {
    expect(parseAttentionMeta(null)).toBeNull();
    expect(parseAttentionMeta(undefined)).toBeNull();
    expect(parseAttentionMeta('')).toBeNull();
    expect(parseAttentionMeta('not json')).toBeNull();
    expect(parseAttentionMeta(JSON.stringify({ source: 'slack' }))).toBeNull();
    expect(parseAttentionMeta(JSON.stringify({ _attention: 'oops' }))).toBeNull();
    expect(parseAttentionMeta(JSON.stringify(['array']))).toBeNull();
  });
});
