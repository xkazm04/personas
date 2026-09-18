import { describe, expect, it } from 'vitest';
import { parseHarvestCounts, parseStatus } from '../useScraperData';

/**
 * Sweep #48 — the scraper's default failure mode is "success, zero records":
 * a page redesign moves every selector, the fetch still returns 200, and the
 * run reports `ok — 0 new`. `parseStatus` treated any `ok` prefix as green, so
 * a dead extraction and a quiet day painted the same pill.
 */

describe('parseHarvestCounts', () => {
  it('returns null for a line that carries no counters, rather than a zero', () => {
    expect(parseHarvestCounts('finished')).toBeNull();
  });

  it('reads both counters', () => {
    expect(parseHarvestCounts('2 new, 1 changed, 40 unchanged')).toEqual({ added: 2, changed: 1 });
  });

  it('reads a partial line without inventing the missing counter', () => {
    expect(parseHarvestCounts('0 new')).toEqual({ added: 0, changed: 0 });
  });
});

describe('parseStatus', () => {
  it('flags a zero harvest against a non-empty dataset as collapsed, not ok', () => {
    const s = parseStatus('ok — 0 new, 0 changed, 128 unchanged', 128);
    expect(s.collapsed).toBe(true);
    expect(s.tone).toBe('collapsed');
  });

  it('leaves an honest first run alone: zero harvest, empty dataset', () => {
    const s = parseStatus('ok — 0 new, 0 changed', 0);
    expect(s.collapsed).toBe(false);
    expect(s.tone).toBe('ok');
  });

  it('does not guess when the dataset count is unknown', () => {
    const s = parseStatus('ok — 0 new, 0 changed');
    expect(s.collapsed).toBe(false);
    expect(s.tone).toBe('ok');
  });

  it('keeps a productive run green', () => {
    const s = parseStatus('ok — 3 new, 1 changed', 128);
    expect(s.collapsed).toBe(false);
    expect(s.tone).toBe('ok');
    expect(s.text).toBe('3 new, 1 changed');
  });

  it('never re-labels a reported error as collapsed', () => {
    const s = parseStatus('error — 403 Forbidden', 128);
    expect(s.tone).toBe('error');
    expect(s.collapsed).toBe(false);
    expect(s.ok).toBe(false);
  });

  it('reports a never-run scrape as unknown, not ok', () => {
    const s = parseStatus(null, 128);
    expect(s.tone).toBe('unknown');
    expect(s.ok).toBeNull();
  });

  it('does not call an uncounted ok line collapsed', () => {
    const s = parseStatus('ok — finished', 128);
    expect(s.collapsed).toBe(false);
    expect(s.tone).toBe('ok');
  });
});
