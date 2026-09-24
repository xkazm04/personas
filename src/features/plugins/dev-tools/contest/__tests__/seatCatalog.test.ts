import { describe, expect, it } from 'vitest';

import {
  addSeat,
  CONTEST_MODEL_CATALOG,
  duplicateSeatIds,
  formatSeatSpec,
  parseSeatSpec,
  seatId,
  specsFromLineup,
} from '../model/seatCatalog';

describe('seatCatalog', () => {
  it('carries the catalog the brief fixes', () => {
    expect(CONTEST_MODEL_CATALOG.claude).toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5']);
    expect(CONTEST_MODEL_CATALOG.codex).toEqual(['gpt-6-sol', 'gpt-6-astra']);
    expect(CONTEST_MODEL_CATALOG.grok).toEqual(['grok-4.6']);
  });

  it('parses and formats the skill examples round-trip', () => {
    for (const raw of ['claude:opus@xhigh', 'grok:grok-4.6@high', 'codex:gpt-5.6-sol@high#second']) {
      const spec = parseSeatSpec(raw);
      expect(spec).not.toBeNull();
      expect(formatSeatSpec(spec!)).toBe(raw);
    }
    expect(parseSeatSpec('  claude:opus@max  ')).toEqual({ engine: 'claude', model: 'opus', effort: 'max', label: null });
  });

  it('rejects what parseParticipant rejects', () => {
    for (const bad of [
      'claude-opus@high', // no engine separator
      'claude:opus', // no effort
      'gemini:pro@high', // unknown engine
      'claude:opus@ultra', // unknown effort
      'Claude:opus@high', // engine is lowercase only
      'claude:op us@high', // space in model
      'claude:opus@high#a/b', // slash in label
      '',
    ]) {
      expect(parseSeatSpec(bad)).toBeNull();
    }
  });

  it('builds the seat id with the skill rule', () => {
    expect(seatId({ engine: 'claude', model: 'opus', effort: 'xhigh', label: null })).toBe('claude-opus_xhigh');
    expect(seatId({ engine: 'codex', model: 'gpt-5.6-sol', effort: 'high', label: 'second' })).toBe(
      'codex-gpt-5.6-sol_high-second',
    );
    // Characters outside [A-Za-z0-9._-] become '_' (the free-text field can carry them).
    expect(seatId({ engine: 'grok', model: 'grok 4', effort: 'low', label: null })).toBe('grok-grok_4_low');
  });

  it('flags duplicate seats and a label separates them', () => {
    const a = { engine: 'claude' as const, model: 'opus', effort: 'high' as const, label: null };
    expect(duplicateSeatIds([a, a])).toEqual(['claude-opus_high']);
    expect(duplicateSeatIds([a, { ...a, label: '2' }])).toEqual([]);
    expect(duplicateSeatIds([a, { ...a, effort: 'low' }])).toEqual([]);
  });

  it('addSeat labels a repeat click instead of duplicating', () => {
    const a = { engine: 'claude' as const, model: 'opus', effort: 'high' as const, label: null };
    const two = addSeat(addSeat([], a), a);
    const three = addSeat(two, a);
    expect(three.map(formatSeatSpec)).toEqual(['claude:opus@high', 'claude:opus@high#2', 'claude:opus@high#3']);
    expect(duplicateSeatIds(three)).toEqual([]);
  });

  it('specsFromLineup counts what no longer parses', () => {
    const r = specsFromLineup(['claude:opus@high', 'nope', 'grok:grok-4.6@low']);
    expect(r.specs.map(formatSeatSpec)).toEqual(['claude:opus@high', 'grok:grok-4.6@low']);
    expect(r.dropped).toBe(1);
  });
});
