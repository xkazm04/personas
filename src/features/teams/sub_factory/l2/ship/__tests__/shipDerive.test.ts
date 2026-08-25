import { describe, expect, it } from 'vitest';

import { SHIP_CRITERIA, deriveCriteria } from '../shipCriteria';
import { deriveCutTally, deriveFootprint, deriveProgress } from '../shipDerive';
import { shipVerdict, type ExitCriterion, type ShipGoal, type ShipMember } from '../shipModel';

import { T, TX, ctx, feature, goal, member, milestone } from './shipFixtures';

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
      row: milestone(), core, boundGoals: [goal('g1', 'Ship it')], footprint: fp,
      monitoringWired: true, llmWired: true, skillCoverage: [], t: T, tx: TX,
    });
    expect(shipVerdict(legacyOnly(criteria))).toBe('nogo');
  });
});

describe('deriveCriteria (behaviour snapshot)', () => {
  const base = { row: milestone(), monitoringWired: true, llmWired: true, skillCoverage: [], t: T, tx: TX };

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

describe('the registry', () => {
  const base = { row: milestone(), monitoringWired: true, llmWired: true, skillCoverage: [], t: T, tx: TX };

  it('runs every registered criterion, in table order', () => {
    const criteria = deriveCriteria({ ...base, core: [], boundGoals: [], footprint: [] });
    expect(criteria.map((c) => c.id)).toEqual(SHIP_CRITERIA.map((s) => s.id));
    expect(criteria.map((c) => c.id)).toEqual(['contexts', 'kpi', 'objective', 'sensors', 'scope-frozen', 'skill-coverage']);
  });

  it('gives every criterion a resolved label and an evidence line', () => {
    const criteria = deriveCriteria({ ...base, core: [], boundGoals: [], footprint: [] });
    for (const c of criteria) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.label).not.toContain('{');
      expect(c.evidence).not.toContain('{');
    }
  });
});

describe('scope-frozen', () => {
  const base = { monitoringWired: true, llmWired: true, skillCoverage: [], t: T, tx: TX, boundGoals: [], footprint: [] };
  const scope = (over: Parameters<typeof deriveCriteria>[0]) =>
    deriveCriteria(over).find((c) => c.id === 'scope-frozen')!;

  const clean = member(feature('f1', 'login', [auth]));
  const late = member(feature('f2', 'export', [auth]), 'core', true);
  const alsoLate = member(feature('f3', 'audit log', [auth]), 'core', true);

  it('reads go when nothing joined after the cut', () => {
    expect(scope({ ...base, row: milestone({ cutAt: '2026-01-01T00:00:00Z' }), core: [clean] }))
      .toEqual({
        id: 'scope-frozen',
        label: 'Scope frozen',
        evidence: 'Nothing joined the cut after certification',
        done: 1,
        total: 1,
        state: 'go',
      });
  });

  it('reads warn and NAMES the offenders when the cut kept growing', () => {
    const c = scope({ ...base, row: milestone({ cutAt: '2026-01-01T00:00:00Z' }), core: [clean, late, alsoLate] });
    expect(c).toEqual({
      id: 'scope-frozen',
      label: 'Scope frozen',
      evidence: '2 added after the cut: export, audit log',
      done: 1,
      total: 3,
      state: 'warn',
    });
  });

  it('reads setup before the cut, where the signal is not meaningful yet', () => {
    expect(scope({ ...base, row: milestone({ cutAt: null }), core: [clean] }))
      .toMatchObject({ evidence: 'Not cut yet. Creep tracking starts at the cut', state: 'setup' });
  });

  it('ignores later / never members, which cannot be creep in the cut', () => {
    const deferred = member(feature('f9', 'later thing', [auth]), 'later', true);
    // the caller passes CORE only; a deferred member never reaches the criterion
    const core = [clean, deferred].filter((m) => m.bucket === 'core');
    expect(scope({ ...base, row: milestone({ cutAt: '2026-01-01T00:00:00Z' }), core })).toMatchObject({ state: 'go' });
  });

  it('participates in the verdict: creep drags an otherwise-clean milestone to warn', () => {
    const core = [clean, late];
    const footprint = deriveFootprint(core, [auth]);
    const all = deriveCriteria({
      ...base, row: milestone({ cutAt: '2026-01-01T00:00:00Z' }), core, footprint,
      boundGoals: [goal('g1', 'Ship v1')],
      // Covered, so `skill-coverage` reads `go` and the only criterion left
      // moving the verdict is the one this test is about. An unwired coverage
      // would report `setup`, which outranks `warn`, and the test would pass or
      // fail for a reason that has nothing to do with scope creep.
      skillCoverage: [{ skill: 'perfect', contextIds: new Set(footprint.map((c) => c.id)) }],
    });
    expect(shipVerdict(legacyOnly(all))).toBe('go');
    expect(shipVerdict(all)).toBe('warn');
  });
});

describe('deriveProgress', () => {
  // The defect this function exists to fix. A milestone whose cut is five
  // goals and zero features is exactly what `show_ship_goals` produces from a
  // brief, and the old derivation (ready features / total features) reported
  // 0% for it forever — a number that could not move whatever happened.
  it('counts a goals-only cut instead of reporting 0% forever', () => {
    const goals = [
      goal('g1', 'Project type: Trailer', [], 'done'),
      goal('g2', 'Compose the story'),
      goal('g3', 'Decompose into scene stories'),
      goal('g4', 'Research the references', [], 'done'),
    ];
    expect(deriveProgress([], goals)).toBe(50);
  });

  it('counts features by the AUTOMATION and goals by their status, in one tally', () => {
    const core = [
      member(feature('f1', 'login', [auth], true)),
      member(feature('f2', 'invoice', [auth], false)),
    ];
    // 1 ready feature + 1 done goal out of 4 members.
    expect(deriveProgress(core, [goal('g1', 'a', [], 'done'), goal('g2', 'b')])).toBe(50);
  });

  it('reads goal status through the shared normalizer, not a raw string compare', () => {
    // v1 of the Goals module compared raw strings and mis-laned every
    // in-progress goal. These four aliases all mean done; the rest do not.
    for (const done of ['done', 'completed', 'complete', 'skipped']) {
      expect(deriveProgress([], [goal('g', 'x', [], done)])).toBe(100);
    }
    for (const open of ['open', 'in_progress', 'in-progress', 'blocked', 'awaiting_acceptance']) {
      expect(deriveProgress([], [goal('g', 'x', [], open)])).toBe(0);
    }
  });

  it('is 0 for an empty cut — a milestone with nothing in it finished nothing', () => {
    expect(deriveProgress([], [])).toBe(0);
  });

  it('still ignores the operator rating, which is a second opinion and not a gate', () => {
    const distrusted = member(feature('f1', 'login', [auth], true), 'core', false, { rating: 1 });
    const vouched = member(feature('f2', 'invoice', [auth], false), 'core', false, { rating: 5 });
    expect(deriveProgress([distrusted, vouched], [])).toBe(50);
  });

  it('preserves the feature-only behaviour it replaced', () => {
    const core = [
      member(feature('f1', 'a', [auth], true)),
      member(feature('f2', 'b', [auth], true)),
      member(feature('f3', 'c', [auth], false)),
    ];
    expect(deriveProgress(core, [])).toBe(67);
  });
});

describe('deriveCutTally', () => {
  // The header renders a fraction and the bar renders a percent. Before this
  // was one function they were computed in two places over two different member
  // sets, so a goals-only cut showed "0 of 0" beside a bar that had at least
  // been taught to count goals. These assert they cannot diverge again.
  it('counts both member kinds, each done by its own reading', () => {
    const ready = member(feature('f1', 'login', [], true));
    const notReady = member(feature('f2', 'billing', [], false));
    const done = goal('g1', 'ship the brief');
    const open = goal('g2', 'research it');
    const tally = deriveCutTally(
      [ready, notReady],
      [{ ...done, status: 'done' }, { ...open, status: 'in-progress' }],
    );
    expect(tally).toEqual({ done: 2, total: 4 });
  });

  it('agrees with deriveProgress, always', () => {
    const cases: [ShipMember[], ShipGoal[]][] = [
      [[], []],
      [[member(feature('f1', 'a', [], true))], []],
      [[], [{ ...goal('g1', 'g'), status: 'done' }]],
      [[member(feature('f1', 'a', [], false))], [{ ...goal('g1', 'g'), status: 'done' }]],
    ];
    for (const [core, goals] of cases) {
      const { done, total } = deriveCutTally(core, goals);
      const expected = total === 0 ? 0 : Math.round((done / total) * 100);
      expect(deriveProgress(core, goals)).toBe(expected);
    }
  });

  it('reads a goals-only cut as real work, not as nothing', () => {
    // The shape a milestone takes the moment its brief is decomposed.
    const goals = [
      { ...goal('g1', 'research'), status: 'done' },
      { ...goal('g2', 'registry'), status: 'done' },
      { ...goal('g3', 'project type'), status: 'open' },
    ];
    expect(deriveCutTally([], goals)).toEqual({ done: 2, total: 3 });
    expect(deriveProgress([], goals)).toBe(67);
  });

  it('counts every non-done status as not done, through the normalizer', () => {
    for (const status of ['open', 'in-progress', 'awaiting_acceptance', 'blocked']) {
      expect(deriveCutTally([], [{ ...goal('g', 'g'), status }]).done).toBe(0);
    }
    // and every alias of done as done
    for (const status of ['done', 'completed', 'complete', 'skipped']) {
      expect(deriveCutTally([], [{ ...goal('g', 'g'), status }]).done).toBe(1);
    }
  });
});

describe('skill-coverage', () => {
  const base = { row: milestone(), monitoringWired: true, llmWired: true, t: T, tx: TX };
  const crit = (over: Partial<Parameters<typeof deriveCriteria>[0]>) =>
    deriveCriteria({ ...base, core: [], boundGoals: [], footprint: [], skillCoverage: [], ...over } as Parameters<typeof deriveCriteria>[0])
      .find((c) => c.id === 'skill-coverage')!;

  const a = ctx('c-a', 'auth', 'ok', 1);
  const b = ctx('c-b', 'billing', 'ok', 1);

  it('reports setup, not failure, when no skill has ever run', () => {
    // An unmeasured surface is not a failing one. `setup` is the same state the
    // sensors criterion uses for "nothing wired yet".
    const c = crit({ footprint: [a, b], skillCoverage: [] });
    expect(c.state).toBe('setup');
    expect(c.done).toBe(0);
    expect(c.total).toBe(2);
  });

  it('reports setup when the cut has no contexts to cover', () => {
    const c = crit({ footprint: [], skillCoverage: [{ skill: 'perfect', contextIds: new Set(['c-a']) }] });
    expect(c.state).toBe('setup');
    expect(c.total).toBe(0);
  });

  it('goes green only when every footprint context is covered', () => {
    const partial = crit({ footprint: [a, b], skillCoverage: [{ skill: 'perfect', contextIds: new Set(['c-a']) }] });
    expect(partial.state).toBe('warn');
    expect(partial.done).toBe(1);
    expect(partial.evidence).toContain('billing');

    const full = crit({ footprint: [a, b], skillCoverage: [{ skill: 'perfect', contextIds: new Set(['c-a', 'c-b']) }] });
    expect(full.state).toBe('go');
    expect(full.done).toBe(2);
  });

  it('counts a context once however many skills reached it', () => {
    // The gate is "is this context covered at all", so two skills on one context
    // is one covered context — not two. Getting this wrong would let a project
    // with many skills and few contexts report over 100%.
    const c = crit({
      footprint: [a, b],
      skillCoverage: [
        { skill: 'perfect', contextIds: new Set(['c-a']) },
        { skill: 'scan-sweep', contextIds: new Set(['c-a']) },
      ],
    });
    expect(c.done).toBe(1);
    expect(c.total).toBe(2);
  });

  it('does NOT count coverage of contexts outside the cut', () => {
    // The denominator is the milestone's footprint, not the project. A skill
    // that has swept forty other contexts has told us nothing about THIS cut,
    // and an implementation that intersected the wrong way would read 100% on a
    // milestone it had never looked at.
    const c = crit({
      footprint: [a],
      skillCoverage: [{ skill: 'perfect', contextIds: new Set(['c-x', 'c-y', 'c-z']) }],
    });
    expect(c.done).toBe(0);
    expect(c.state).toBe('warn');
  });

  it('names each skill against THIS footprint, not against the project', () => {
    const c = crit({
      footprint: [a, b],
      skillCoverage: [
        { skill: 'perfect', contextIds: new Set(['c-a', 'c-b', 'c-elsewhere']) },
        { skill: 'scan-sweep', contextIds: new Set(['c-a']) },
      ],
    });
    // perfect reaches both footprint contexts — 2/2, never 3/2
    expect(c.evidence).toContain('perfect 2/2');
    expect(c.evidence).toContain('scan-sweep 1/2');
  });

  it('leaves a skill that reached nothing in this cut out of the breakdown', () => {
    const c = crit({
      footprint: [a],
      skillCoverage: [
        { skill: 'perfect', contextIds: new Set(['c-a']) },
        { skill: 'uat', contextIds: new Set(['c-elsewhere']) },
      ],
    });
    expect(c.evidence).toContain('perfect 1/1');
    expect(c.evidence).not.toContain('uat');
  });
});

