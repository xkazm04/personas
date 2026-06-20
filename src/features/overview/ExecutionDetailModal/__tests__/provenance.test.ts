import { describe, expect, it } from 'vitest';
import { analyzeProvenance } from '../provenance';

describe('analyzeProvenance', () => {
  it('returns zero for empty/missing content', () => {
    expect(analyzeProvenance(null)).toEqual({ sourceCount: 0, hasFigures: false });
    expect(analyzeProvenance('')).toEqual({ sourceCount: 0, hasFigures: false });
  });

  it('counts bullets under a "## Sources" heading and detects figures', () => {
    const c = [
      'Revenue was $42,300 this month, up from last.',
      '',
      '## Sources',
      "- Revenue $42,300 — SELECT SUM(amount) FROM invoices WHERE month='2026-05' (118 rows)",
      '- 3 open incidents — GET /api/incidents?status=open',
    ].join('\n');
    expect(analyzeProvenance(c)).toEqual({ sourceCount: 2, hasFigures: true });
  });

  it('flags figures with no sources (the gap)', () => {
    expect(analyzeProvenance('Processed 42 invoices, total $5,000.')).toEqual({
      sourceCount: 0,
      hasFigures: true,
    });
  });

  it('returns nothing notable for a plain operational message', () => {
    expect(analyzeProvenance('Task completed successfully. No issues found.')).toEqual({
      sourceCount: 0,
      hasFigures: false,
    });
  });

  it('accepts a bare "Sources:" label and numbered lists', () => {
    const c = 'Done.\n\nSources:\n1. data/export.csv\n2. https://api.example.com/v1/orders';
    const r = analyzeProvenance(c);
    expect(r.sourceCount).toBe(2);
  });

  it('accepts a bold "**Sources**" heading', () => {
    expect(analyzeProvenance('**Sources**\n- ledger.db').sourceCount).toBe(1);
  });

  it('only counts items under the Sources section, not later headings', () => {
    const c = '## Sources\n- a.csv\n- b.csv\n\n## Notes\n- not a source\n- also not';
    expect(analyzeProvenance(c).sourceCount).toBe(2);
  });

  it('does not treat the word "sources" in prose as a section', () => {
    expect(analyzeProvenance('We cross-checked multiple data sources for accuracy.').sourceCount).toBe(0);
  });
});
