import { describe, expect, it } from 'vitest';
import { FIXTURE_ITEMS, fixtureCounts } from '../../../fixtures';
import { costOf, headingSlug, headingsOf, queueFor, readerMarkdown } from '../model';
import { resolveStart, withDemoStates } from '../start';

const byId = (id: string) => FIXTURE_ITEMS.find((i) => i.id === id)!;

describe('p3 model', () => {
  it('prices each item by what deciding it takes', () => {
    expect(costOf(byId('review:r1'))).toBe('1 key · 2 options');
    expect(costOf(byId('approval:a1'))).toBe('1 key');
    expect(costOf(byId('question:q1'))).toBe('2 answers');
    expect(costOf(byId('idea:d1'))).toBe('Effort 3/10');
    expect(costOf(byId('message:m1'))).toBe('Reply');
    expect(costOf(byId('report:rep1'))).toMatch(/min read$/);
  });

  it('drops a leading H1 that repeats the title, and lists only ## / ### as contents', () => {
    const rep = byId('report:rep1');
    expect(readerMarkdown(rep).startsWith('# ')).toBe(false);
    const hs = headingsOf(readerMarkdown(rep));
    expect(hs.map((h) => h.text)).toEqual(['Throughput', 'What needs you', 'Detail']);
    expect(hs[0]!.id).toBe(headingSlug('Throughput'));
  });

  it('walks one chip or the whole roster', () => {
    expect(queueFor(FIXTURE_ITEMS, 'reports').map((i) => i.id)).toEqual(['report:rep1', 'report:rep2']);
    expect(queueFor(FIXTURE_ITEMS, 'all')).toHaveLength(FIXTURE_ITEMS.length);
  });
});

describe('p3 start', () => {
  it('opens modal:report on the markdown report so → reaches the HTML one', () => {
    const s = resolveStart(FIXTURE_ITEMS, { level: 'modal', type: 'report' });
    expect(s.desk).toEqual({ scope: 'reports', index: 0, origin: 'peek' });
  });

  it('demo states mark council failed and chat empty without dropping other chips', () => {
    const { items, counts } = withDemoStates(FIXTURE_ITEMS, fixtureCounts(FIXTURE_ITEMS, []));
    expect(counts.council.failed).toBe(true);
    expect(counts.chat.n).toBe(0);
    expect(items.some((i) => i.kind === 'message')).toBe(false);
    expect(counts.gates.n).toBeGreaterThan(0);
  });
});
