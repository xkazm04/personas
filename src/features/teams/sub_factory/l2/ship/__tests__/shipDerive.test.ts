import { describe, expect, it } from 'vitest';

import { deriveCriteria, deriveFootprint } from '../shipDerive';
import { shipVerdict, type ExitCriterion } from '../shipModel';

import { T, TX, ctx, feature, goal, member } from './shipFixtures';

/** The four criteria that existed before the registry. Filtering to these
 *  keeps the behaviour snapshot meaningful as new criteria are registered. */
const LEGACY = ['contexts', 'kpi', 'objective', 'sensors'];
const legacyOnly = (cs: ExitCriterion[]) => cs.filter((c) => LEGACY.includes(c.id));

const auth = ctx('c-auth', 'auth', 'ok', 2);
const billing = ctx('c-billing', 'billing', 'warn', 1, 3);
const search = ctx('c-search', 'search', 'setup', 0);
const crit = ctx('c-crit', 'sync', 'crit', 1, 40);

describe('deriveFootprint', () => {
  it('flattens CORE members slices, deduped, in first-appearance order', () => {
    const core = [
      member(feature('f1', 'login', [auth, billing])),
      member(feature('f2', 'invoice', [billing, search])),
    ];
    expect(deriveFootprint(core, [search, billing, auth]).map((c) => c.id))
      .toEqual(['c-auth', 'c-billing', 'c-search']);
  });

  it('ignores later / never members', () => {
    const core = [
      member(feature('f1', 'login', [auth])),
      member(feature('f2', 'invoice', [billing]), 'later'),
      member(feature('f3', 'archive', [search]), 'never'),
    ];
    expect(deriveFootprint(core.filter((m) => m.bucket === 'core'), [auth, billing, search]).map((c) => c.id))
      .toEqual(['c-auth']);
  });

  it('drops members whose context no longer resolves', () => {
    const gone = ctx('c-gone', 'retired', 'ok');
    const core = [member(feature('f1', 'login', [auth, gone]))];
    expect(deriveFootprint(core, [auth]).map((c) => c.id)).toEqual(['c-auth']);
  });

  // The bug this direction fixes. The auto-generated context map produces
  // near-identical names ("teams/factory [1/3]", "[2/3]") and a rescan can
  // rename a context, so a name-keyed join collapses distinct contexts into
  // one and silently shrinks the footprint the exit criteria are computed on.
  it('keeps BOTH contexts when two share a display name', () => {
    const a = ctx('c-a', 'teams/factory', 'ok', 1);
    const b = ctx('c-b', 'teams/factory', 'crit', 1, 40);
    const core = [member(feature('f1', 'wall', [a, b]))];
    const fp = deriveFootprint(core, [a, b]);
    expect(fp.map((c) => c.id)).toEqual(['c-a', 'c-b']);
    // and the collision therefore cannot hide a critical context from the verdict
    const criteria = deriveCriteria({
      core, boundGoals: [goal('g1', 'Ship it')], footprint: fp,
      monitoringWired: true, llmWired: true, t: T, tx: TX,
    });
    expect(shipVerdict(legacyOnly(criteria))).toBe('nogo');
  });
});

describe('deriveCriteria (behaviour snapshot)', () => {
  const base = { monitoringWired: true, llmWired: true, t: T, tx: TX };

  it('pins the healthy full-coverage case', () => {
    const core = [member(feature('f1', 'login', [auth]))];
    const criteria = legacyOnly(deriveCriteria({ ...base, core, boundGoals: [goal('g1', 'Ship v1')], footprint: deriveFootprint(core, [auth]) }));
    expect(criteria).toEqual([
      { id: 'contexts', label: 'Core contexts healthy', evidence: '1 of 1 in-scope contexts healthy', done: 1, total: 1, state: 'go' },
      { id: 'kpi', label: 'KPI coverage on core scope', evidence: '1 of 1 core contexts carry an active KPI', done: 1, total: 1, state: 'go' },
      { id: 'objective', label: 'Objective bound', evidence: 'Ship v1', done: 1, total: 1, state: 'go' },
      { id: 'sensors', label: 'Sensors wired', evidence: 'Monitoring + LLM tracking both report', done: 2, total: 2, state: 'go' },
    ]);
    expect(shipVerdict(criteria)).toBe('go');
  });

  it('pins the empty-cut case', () => {
    const criteria = legacyOnly(deriveCriteria({ ...base, core: [], boundGoals: [], footprint: [], monitoringWired: false, llmWired: false }));
    expect(criteria).toEqual([
      { id: 'contexts', label: 'Core contexts healthy', evidence: 'No core scope yet. Compose the cut first', done: 0, total: 0, state: 'setup' },
      { id: 'kpi', label: 'KPI coverage on core scope', evidence: 'Coverage derives once the cut has members', done: 0, total: 0, state: 'setup' },
      { id: 'objective', label: 'Objective bound', evidence: 'Bind a measurable goal from the composer', done: 0, total: 1, state: 'setup' },
      { id: 'sensors', label: 'Sensors wired', evidence: 'Bind monitoring / LLM connectors in Observability', done: 0, total: 2, state: 'setup' },
    ]);
    expect(shipVerdict(criteria)).toBe('setup');
  });

  it('pins the mixed-health / partial-coverage case', () => {
    const core = [member(feature('f1', 'login', [auth, billing, search, crit]))];
    const footprint = deriveFootprint(core, [auth, billing, search, crit]);
    const criteria = legacyOnly(deriveCriteria({ ...base, core, boundGoals: [goal('g1', 'A'), goal('g2', 'B')], footprint, llmWired: false }));
    expect(criteria).toEqual([
      { id: 'contexts', label: 'Core contexts healthy', evidence: '1 of 4 in-scope contexts healthy · critical: sync', done: 1, total: 4, state: 'nogo' },
      { id: 'kpi', label: 'KPI coverage on core scope', evidence: '3 of 4 core contexts carry an active KPI', done: 3, total: 4, state: 'warn' },
      { id: 'objective', label: 'Objective bound', evidence: 'A · B', done: 1, total: 1, state: 'go' },
      { id: 'sensors', label: 'Sensors wired', evidence: 'Bind monitoring / LLM connectors in Observability', done: 1, total: 2, state: 'setup' },
    ]);
    expect(shipVerdict(criteria)).toBe('nogo');
  });

  it('reads warn on the contexts criterion when nothing is critical but not all healthy', () => {
    const core = [member(feature('f1', 'login', [auth, search]))];
    const footprint = deriveFootprint(core, [auth, search]);
    const criteria = legacyOnly(deriveCriteria({ ...base, core, boundGoals: [goal('g1', 'A')], footprint }));
    expect(criteria.map((c) => c.state)).toEqual(['warn', 'warn', 'go', 'go']);
    expect(shipVerdict(criteria)).toBe('warn');
  });
});
