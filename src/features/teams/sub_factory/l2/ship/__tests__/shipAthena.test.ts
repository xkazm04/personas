// The Ask-Athena pointer and the readiness snapshot it replaced half of.
//
// These two things are one subject. The pointer used to carry the verdict
// because nothing else could; the snapshot exists so it does not have to. So
// the assertions below are mostly ABSENCE assertions — that the message does
// NOT contain a conclusion or a response script — and a shape assertion that
// the snapshot really is a faithful copy of what the tab derived.
//
// The `errors: null` case is the one worth staring at: `null` means monitoring
// is not wired, `0` means no errors this week, and the Rust reader renders them
// as different sentences. A publisher that coerced one to the other would make
// the read op state a fact nobody measured.
import { describe, expect, it } from 'vitest';

import type { DevProject } from '@/lib/bindings/DevProject';

import { buildShipAskPrompt } from '../shipAthena';
import { buildReadinessPayload, SHIP_READINESS_DOC_VERSION } from '../shipReadinessPublish';
import type { ExitCriterion, ShipMilestoneVM } from '../shipModel';
import { ctx, feature, member, milestone } from './shipFixtures';

const crit = (over: Partial<ExitCriterion> = {}): ExitCriterion => ({
  id: 'objective',
  label: 'Objective bound',
  evidence: 'no goal bound to this milestone',
  done: 0,
  total: 1,
  state: 'nogo',
  ...over,
});

const auth = ctx('c-auth', 'auth', 'ok', 2, 0);
/** Monitoring not wired — deliberately `null`, not `0`. */
const dark = ctx('c-dark', 'ingest', 'setup', 0, null);

function vm(over: Partial<ShipMilestoneVM> = {}): ShipMilestoneVM {
  return {
    row: milestone(),
    id: 'ms-1',
    name: 'Test milestone',
    goal: 'Gathering knowledge for trailer storytelling',
    description: 'Deep research web resources.\nOut of scope: script to image.',
    status: 'planned',
    targetLabel: null,
    members: [member(feature('f1', 'login', [auth]))],
    boundGoals: [],
    footprint: [auth, dark],
    criteria: [crit()],
    progress: 42.4,
    duality: { rated: 0, unrated: 1, agree: 0, disagree: 0, conflicts: [] },
    ...over,
  };
}

const project = { id: 'p1', name: 'gravitone' } as DevProject;

describe('buildShipAskPrompt', () => {
  it('names the operator, the project and the milestone id', () => {
    const out = buildShipAskPrompt(vm(), project);
    expect(out).toContain('gravitone');
    expect(out).toContain('ms-1');
    expect(out).toContain('Test milestone');
    expect(out).toContain('describe_ship_milestone');
  });

  it('names the verdict as something the OP answers, never as a value', () => {
    // The distinction this test exists to hold. Saying "the op carries the
    // verdict" is a pointer — it tells her where to look. Saying "the verdict
    // is setup" is a conclusion, and a conclusion handed to a model before it
    // has read anything comes back as that model's own finding. The old
    // builder did the second (`the ship verdict is **${verdict}**` plus an
    // unmet-criteria roll-up), which is precisely what produced a turn that
    // restated the pasted word and asked the operator to explain his own
    // milestone. So: the WORD may appear, a VALUE may not.
    const out = buildShipAskPrompt(vm(), project);
    expect(out).toMatch(/verdict/i);
    // No asserted value, in any of the forms the retired builder could emit.
    expect(out).not.toMatch(/verdict is/i);
    expect(out).not.toMatch(/\*\*(go|warn|nogo|setup)\*\*/i);
    expect(out).not.toMatch(/unmet criteria/i);
    expect(out).not.toMatch(/every exit criterion is currently met/i);
    // And no count of anything — a "2/5" is a conclusion wearing a number.
    expect(out).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it('carries NO response script', () => {
    // The retired paragraph named the output shape ("a SHORT read", "the one
    // thing you would look at first") and then told her to stop investigating
    // ("then let him talk"). How she works a milestone is constitution
    // doctrine; a per-message script neither survives nor generalises.
    const out = buildShipAskPrompt(vm(), project).toLowerCase();
    for (const phrase of ['short read', 'let him talk', 'first', 'what he wants']) {
      expect(out).not.toContain(phrase);
    }
  });

  it('does not paste the cut, the goals or the objective prose', () => {
    // The whole point of the pointer: the op is the one place any of this is
    // read, so a copy here can only be a second copy that goes stale.
    const out = buildShipAskPrompt(vm(), project);
    expect(out).not.toContain('Deep research web resources');
    expect(out).not.toContain('login');
    expect(out).not.toContain('trailer storytelling');
  });

  it('stays short — a pointer, not a briefing', () => {
    expect(buildShipAskPrompt(vm(), project).length).toBeLessThan(700);
  });
});

describe('buildReadinessPayload', () => {
  it('publishes the derived verdict, progress and criteria for every milestone', () => {
    const doc = buildReadinessPayload([vm(), vm({ id: 'ms-2', criteria: [crit({ state: 'go', done: 1 })] })]);
    expect(doc.version).toBe(SHIP_READINESS_DOC_VERSION);
    expect(doc.milestones.map((m) => m.id)).toEqual(['ms-1', 'ms-2']);
    expect(doc.milestones[0].verdict).toBe('nogo');
    expect(doc.milestones[1].verdict).toBe('go');
    expect(doc.milestones[0].criteria[0]).toEqual({
      label: 'Objective bound',
      state: 'nogo',
      evidence: 'no goal bound to this milestone',
      done: 0,
      total: 1,
    });
  });

  it('rounds progress — the Rust contract reads it as an integer', () => {
    expect(buildReadinessPayload([vm()]).milestones[0].progress).toBe(42);
  });

  it('preserves `errors: null` as null — not wired is not zero', () => {
    const contexts = buildReadinessPayload([vm()]).milestones[0].contexts;
    expect(contexts.find((c) => c.name === 'auth')?.errors).toBe(0);
    expect(contexts.find((c) => c.name === 'ingest')?.errors).toBeNull();
  });

  it('publishes the whole roadmap, so switching selection cannot narrow it', () => {
    // She must be able to answer about a milestone the operator is not
    // currently looking at; a one-entry document would make the read op say
    // "no verdict" for every other milestone in the project.
    expect(buildReadinessPayload([vm(), vm({ id: 'ms-2' }), vm({ id: 'ms-3' })]).milestones).toHaveLength(3);
  });

  it('carries no member names, ratings or notes — the read op reads those from SQL', () => {
    const body = JSON.stringify(buildReadinessPayload([vm()]));
    expect(body).not.toContain('login');
    expect(body).not.toContain('trailer storytelling');
  });
});
