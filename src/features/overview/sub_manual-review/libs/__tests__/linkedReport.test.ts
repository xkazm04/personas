import { describe, it, expect } from 'vitest';
import { parseLinkedReportId } from '../linkedReport';

describe('parseLinkedReportId', () => {
  it('reads reportId from the review context', () => {
    expect(parseLinkedReportId('{"reportId":"rep-42"}')).toBe('rep-42');
  });

  it('finds it beside the other context a review carries', () => {
    const ctx = JSON.stringify({
      reportId: 'rep-7',
      context_text: 'Council review',
      decisions: [{ id: 'd1', label: 'Ship it' }],
    });
    expect(parseLinkedReportId(ctx)).toBe('rep-7');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['free text', 'the agent wants a decision'],
    ['a JSON string', '"rep-1"'],
    ['JSON null', 'null'],
    ['an array', '["rep-1"]'],
    ['an object without the key', '{"decisions":[]}'],
    ['a non-string id', '{"reportId":42}'],
    ['a blank id', '{"reportId":"  "}'],
    ['the snake_case spelling (not the contract)', '{"report_id":"rep-1"}'],
  ])('is null for %s', (_label, ctx) => {
    expect(parseLinkedReportId(ctx)).toBeNull();
  });
});
