import { describe, expect, it } from 'vitest';
import { MAX_LEAD, splitLead } from './text';

describe('splitLead', () => {
  it('keeps a short question whole as the heading', () => {
    expect(splitLead('Two PRs touch the same migration - which one lands first?')).toEqual({
      lead: 'Two PRs touch the same migration - which one lands first?',
      rest: '',
    });
  });

  it('cuts a long question at its first sentence', () => {
    const q = 'Should I proceed with the destructive migration on the production replica now? It drops two columns and cannot be undone once the backfill has finished, so say so if you want a snapshot first.';
    const { lead, rest } = splitLead(q);
    expect(lead).toBe('Should I proceed with the destructive migration on the production replica now?');
    expect(rest.startsWith('It drops two columns')).toBe(true);
    expect(`${lead} ${rest}`).toBe(q);
  });

  it('never cuts a sentence at a comma: a long single sentence has no heading', () => {
    const q = 'Before I touch the billing export I need to know which segment first, the enterprise accounts, the self-serve accounts or the trials, and also which currency the finance team wants the totals in';
    expect(splitLead(q)).toEqual({ lead: '', rest: q });
  });

  it('keeps a sentence a little over the whole-prompt size as the heading when a body follows', () => {
    const q = 'Should I proceed with the destructive migration on the production replica right now, before the export refactor lands? It drops two columns.';
    const { lead, rest } = splitLead(q);
    expect(lead).toBe('Should I proceed with the destructive migration on the production replica right now, before the export refactor lands?');
    expect(rest).toBe('It drops two columns.');
    expect(lead.length).toBeLessThanOrEqual(MAX_LEAD);
  });

  it('puts an unbreakable long run wholly in the description', () => {
    const q = 'word '.repeat(40).trim();
    expect(splitLead(q)).toEqual({ lead: '', rest: q });
  });

  it('does not split on an abbreviation and keeps line breaks in the description', () => {
    const { lead, rest } = splitLead('Which runner (e.g. the staging one) should take this job, given that the queue is full today and the pool is warm and idle?\nLine two\nLine three');
    expect(lead.length).toBeLessThanOrEqual(MAX_LEAD);
    expect(rest).toContain('\nLine two\nLine three');
  });

  it('takes a first line as the heading when the body follows on later lines', () => {
    expect(splitLead('Approve the deploy?\nIt ships build 412 to production.')).toEqual({
      lead: 'Approve the deploy?',
      rest: 'It ships build 412 to production.',
    });
  });
});
