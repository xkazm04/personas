/**
 * The honesty rules, held to at the model boundary.
 *
 * These are the page's whole argument, and they are the rules a type-check, a
 * lint pass and a screenshot all miss: a number that should not exist is
 * indistinguishable from one that should, unless something asserts it.
 */
import { describe, expect, it } from 'vitest';

import { buildModel } from '../model/buildModel';
import { markOfReason } from '../model/parseClause';
import { DEVIATION, item, plan, THIN } from './fixture';

describe('an unknown never becomes a zero', () => {
  it('leaves the demand-fed channels UNKNOWN where the bundle reports no demand', () => {
    const model = buildModel(plan());
    const czech = model.rows.find((r) => r.id === 'localization/czech')!;
    expect(czech.cells[1]).toEqual({ kind: 'unknown' });
    expect(czech.cells[7]).toEqual({ kind: 'unknown' });
    // and there is no number anywhere in the mark to mistake for a count
    expect(JSON.stringify(czech.cells[7])).not.toContain('0');
  });

  it('calls the SAME channels a measured zero where demand was read', () => {
    const model = buildModel(plan());
    const memory = model.rows.find((r) => r.id === 'software-engineering/agent-memory')!;
    expect(memory.cells[1]).toEqual({ kind: 'measured-zero' });
  });

  it('never counts an unknown into a channel total', () => {
    const model = buildModel(plan());
    // Channel 1 scores nowhere; one row measured it as nothing and one could
    // not look at all. The total is 0 subjects, not 1.
    expect(model.totals[1]).toMatchObject({ points: 0, subjects: 0 });
  });
});

describe('three empty states, three different marks', () => {
  it('keeps a real count, a measured zero and an unknown apart', () => {
    const model = buildModel(plan());
    const memory = model.rows.find((r) => r.id === 'software-engineering/agent-memory')!;
    const czech = model.rows.find((r) => r.id === 'localization/czech')!;
    const kinds = [memory.cells[7].kind, memory.cells[1].kind, czech.cells[7].kind];
    expect(kinds).toEqual(['scored', 'measured-zero', 'unknown']);
    expect(new Set(kinds).size).toBe(3);
  });

  it('gives each zero column its own reason for being zero', () => {
    const model = buildModel(plan());
    // 1 and 7 are written by consumers and one bundle of two was never read.
    expect(model.totals[1].emptiness).toBe('unknown-remainder');
    // 3 cannot be asked of an application that carries no clock.
    expect(model.totals[3].emptiness).toBe('unmeasurable-remainder');
    // 6 is a clean zero: nothing here, and nothing unasked.
    expect(model.totals[6].emptiness).toBe('pure');
    // a column that SCORES has no emptiness at all
    expect(model.totals[7].emptiness).toBeNull();
  });

  it('calls channel 3 a clean zero once every application carries a clock', () => {
    const p = plan();
    p.run.corpus.noClockApplications = 0;
    expect(buildModel(p).totals[3].emptiness).toBe('pure');
  });
});

describe('the quiet band comes from CuratorPlan.quiet', () => {
  it('reads the count off the tail rather than subtracting figures', () => {
    const model = buildModel(plan());
    expect(model.quietSubjects).toBe(4);
    expect(model.quiet).toHaveLength(2);
    expect(model.quiet.find((q) => q.domain === 'localization')).toEqual({
      domain: 'localization',
      subjects: 1,
      demandKnown: false,
    });
  });

  it('is empty, not zero, when the projection carries no tail', () => {
    const p = plan();
    p.quiet = [];
    const model = buildModel(p);
    expect(model.quietSubjects).toBe(0);
    expect(model.quiet).toEqual([]);
  });

  it('accounts for every subject the corpus counts, or says how many it cannot', () => {
    // 6 subjects, 2 carried as items, 4 quiet: nothing is unlisted.
    expect(buildModel(plan()).unlisted).toBe(0);
    const p = plan();
    p.run.corpus.subjects = 10;
    // Four more the projection does not carry. That is a finding, not work.
    expect(buildModel(p).unlisted).toBe(4);
  });
});

describe('a clause keeps its points even when its prose is unfamiliar', () => {
  it('reads the spread out of the scan’s own sentence', () => {
    const mark = markOfReason(DEVIATION)!;
    expect(mark).toMatchObject({ channel: 7, points: 56, floor: 14, ceil: 28 });
  });

  it('reads the design floor a technique count is under', () => {
    expect(markOfReason(THIN)).toMatchObject({ channel: 4, count: 3, designFloor: 4 });
  });

  it('keeps the points when the sentence parses into nothing', () => {
    const mark = markOfReason({ code: 'deviation', weight: 12, detail: 'reworded by the registry' })!;
    expect(mark.points).toBe(12);
    expect(mark.floor).toBeUndefined();
  });

  it('drops a clause this app has no channel for, rather than guessing one', () => {
    expect(markOfReason({ code: 'none', weight: 0, detail: 'unknown clause' })).toBeNull();
  });
});

describe('the ledger ranks by points and keeps the plan order', () => {
  it('ranks from the scan’s own points, breaking ties by id', () => {
    const model = buildModel(plan());
    expect(model.rows.map((r) => [r.rank, r.points])).toEqual([
      [1, 56],
      [2, 4],
    ]);
    expect(model.planPoints).toBe(60);
  });

  it('gives every bundle a distinct short mark', () => {
    const model = buildModel(plan());
    const marks = Object.values(model.bundleMark);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('never claims demand for a subject whose bundle reports none', () => {
    const model = buildModel(
      plan({ items: [item({ demandKnown: false, demand: null, reasons: [] })] }),
    );
    expect(model.rows[0]!.demand).toBeNull();
    expect(model.rows[0]!.cells[7]).toEqual({ kind: 'unknown' });
  });
});
