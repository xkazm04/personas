import { beforeEach, describe, expect, it } from 'vitest';

import { healthyMix } from '../../../../journey/__tests__/fixtures';
import { instrumentGateDetail } from '../../../../journey/__tests__/gateFixtures';
import { commandRows } from '../../gateModel';
import {
  DEFAULT_VIEW, __resetGateViewForTests, filterCounts, instrumentRows, rememberView, rememberedView, sortRows, viewRows,
} from '../gateView';

function rows(measureId: string | null = null) {
  const detail = instrumentGateDetail();
  return instrumentRows(commandRows(detail.runs, null, healthyMix().rules), detail.related, measureId);
}

const ids = (list: { commandId: string }[]) => list.map((r) => r.commandId);

beforeEach(() => __resetGateViewForTests());

describe('gate rows: sort', () => {
  it('pipeline order is the order the history first shows each command', () => {
    expect(ids(sortRows(rows(), 'pipeline'))).toEqual(['tsc', 'eslint', 'check', 'clippy']);
  });

  it('slowest first ranks by what the shown run cost; a timeout at its kill time, a run that never started last', () => {
    // check timed out after 10 min (it ran at least that long); clippy did not run.
    expect(ids(sortRows(rows(), 'slowest'))).toEqual(['check', 'tsc', 'eslint', 'clippy']);
    // Travelling to an older Measure ranks by that Measure's runs.
    const older = rows('m-check-1');
    expect(ids(sortRows(older, 'slowest'))[0]).toBe('check');
  });

  it('least reliable first: lowest pass rate, a flaky command a step below its rate, no answers last', () => {
    expect(ids(sortRows(rows(), 'least_reliable'))).toEqual(['eslint', 'tsc', 'check', 'clippy']);
  });
});

describe('gate rows: filter', () => {
  it('counts and filters failing, over budget and flaky by the shown run', () => {
    const all = rows();
    expect(filterCounts(all)).toEqual({ all: 4, failing: 2, over_budget: 1, flaky: 1 });
    expect(ids(viewRows(all, { sort: 'pipeline', filter: 'failing' }))).toEqual(['eslint', 'check']);
    expect(ids(viewRows(all, { sort: 'pipeline', filter: 'over_budget' }))).toEqual(['tsc']);
    expect(ids(viewRows(all, { sort: 'pipeline', filter: 'flaky' }))).toEqual(['eslint']);
  });
});

describe('gate rows: memory', () => {
  it('remembers the choice per step for the session', () => {
    expect(rememberedView('gate')).toEqual(DEFAULT_VIEW);
    rememberView('gate', { sort: 'slowest', filter: 'flaky' });
    expect(rememberedView('gate')).toEqual({ sort: 'slowest', filter: 'flaky' });
    expect(rememberedView('tests')).toEqual(DEFAULT_VIEW);
  });
});
