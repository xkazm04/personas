import { describe, it, expect, beforeEach } from 'vitest';
import { readLastEdited, markPersonaEdited, clearLastEdited, collectRecentFailures } from './useResumeContext';

describe('useResumeContext localStorage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no marker is set', () => {
    expect(readLastEdited()).toBeNull();
  });

  it('round-trips a persona id', () => {
    markPersonaEdited('persona-123');
    const v = readLastEdited();
    expect(v?.personaId).toBe('persona-123');
    expect(typeof v?.at).toBe('number');
  });

  it('expires entries older than 7 days', () => {
    const old = Date.now() - (8 * 24 * 60 * 60 * 1000);
    localStorage.setItem('personas:last-edited-persona', JSON.stringify({ personaId: 'p', at: old }));
    expect(readLastEdited()).toBeNull();
  });

  it('clearLastEdited removes the entry', () => {
    markPersonaEdited('p');
    expect(readLastEdited()).not.toBeNull();
    clearLastEdited();
    expect(readLastEdited()).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem('personas:last-edited-persona', '{not-json');
    expect(readLastEdited()).toBeNull();
  });

  it('returns null on missing fields', () => {
    localStorage.setItem('personas:last-edited-persona', JSON.stringify({ at: Date.now() }));
    expect(readLastEdited()).toBeNull();
  });
});

describe('collectRecentFailures', () => {
  const now = Date.parse('2026-07-30T12:00:00Z');
  const at = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

  it('surfaces a run whose process died (incomplete) and skips a cancelled one', () => {
    const out = collectRecentFailures(
      [
        { id: 'e1', status: 'incomplete', persona_id: 'p1', created_at: at(1) },
        { id: 'e2', status: 'cancelled', persona_id: 'p2', created_at: at(1) },
      ],
      [
        { persona_id: 'p3', status: 'incomplete', created_at: at(2) },
        { persona_id: 'p4', status: 'cancelled', created_at: at(2) },
      ],
      now,
    );
    expect(out.map((c) => c.personaId)).toEqual(['p1', 'p3']);
  });
});
