import { describe, it, expect, beforeEach } from 'vitest';
import { readLastEdited, markPersonaEdited, clearLastEdited } from './useResumeContext';

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
