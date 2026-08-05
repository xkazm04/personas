/**
 * Goal acceptance, seen through the deck.
 *
 * A goal reaches this queue because a team FINISHED something and the outcome
 * needs signing off — the only kind in the deck that is good news by default.
 * The properties worth pinning are the ones a shared surface can quietly lose:
 *
 *  • **A never-baselined KPI has no percentage.** The gauge must stay a raw
 *    `current → target` rather than a fabricated 0%. `goalAcceptanceModel.ts`
 *    documented fixing exactly that bug before it was folded into the shared
 *    triage model; re-deriving the meter here is how it comes back.
 *  • **The bulk affordance survives the move.** `GoalsTriage` was built around
 *    "accept every goal on this KPI"; here that is a digit-hotkeyed branch, and
 *    it must not be offered when there is only one goal to accept.
 *  • **No `seenStatus`.** `resolveGoalAcceptance` takes no seen-status, so goals
 *    are the one kind with no compare-and-swap. Carrying the token anyway would
 *    imply a protection that does not exist.
 */
import { describe, it, expect } from 'vitest';

import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';

import { DEFAULT_TRIAGE_COPY, goalToTriage } from '../triageAdapters';
import { reasonPromptFor, type TriageFact } from '../triageTypes';

const copy = DEFAULT_TRIAGE_COPY;

function pendingGoal(overrides: Partial<PendingAcceptanceGoal> = {}): PendingAcceptanceGoal {
  return {
    goal_id: 'goal-1',
    title: 'Merge the two onboarding flows',
    summary: 'The old wizard is gone; one flow now covers both entry points.',
    project_id: 'proj-1',
    project_name: 'Atlas',
    team_id: 'team-1',
    team_name: 'Growth',
    kpi_id: 'kpi-1',
    kpi_name: 'Activation rate',
    kpi_unit: '%',
    kpi_current: 34,
    kpi_target: 50,
    kpi_baseline: 20,
    kpi_direction: 'up',
    completed_at: '2026-02-02T00:00:00.000Z',
    ...overrides,
  };
}

const factById = (facts: TriageFact[], id: string): TriageFact => {
  const found = facts.find((f) => f.id === id);
  if (!found) throw new Error(`no "${id}" fact on the card`);
  return found;
};

const hasFact = (facts: TriageFact[], id: string): boolean => facts.some((f) => f.id === id);

describe('goalToTriage — a completed goal as a card', () => {
  it('maps the row onto the card the deck renders', () => {
    const item = goalToTriage(pendingGoal(), ['goal-1'], copy);

    expect(item.id).toBe('goal:goal-1');
    expect(item.sourceId).toBe('goal-1');
    expect(item.kind).toBe('goal');
    expect(item.title).toBe('Merge the two onboarding flows');
    expect(item.body).toBe('The old wizard is gone; one flow now covers both entry points.');
    // The team did the work; the project is where it landed.
    expect(item.source).toEqual({ label: 'Growth', sublabel: 'Atlas' });
    expect(item.createdAt).toBe('2026-02-02T00:00:00.000Z');
    expect(item.tags.map((tag) => tag.label)).toEqual(['Growth', 'Atlas']);
  });

  it('falls back to the project when a goal has no owning team', () => {
    const item = goalToTriage(pendingGoal({ team_id: null, team_name: null }), ['goal-1'], copy);
    expect(item.source).toEqual({ label: 'Atlas', sublabel: 'Atlas' });
    expect(item.tags.map((tag) => tag.label)).toEqual(['Atlas']);
    expect(hasFact(item.facts, 'team')).toBe(false);
  });

  it('says so rather than rendering an empty case when the summary is missing', () => {
    expect(goalToTriage(pendingGoal({ summary: null }), ['goal-1'], copy).body).toBe(
      'No description was provided.',
    );
  });

  it('names its verdicts in the goal queue’s own words', () => {
    // "Reject" reads wrong on finished work — the goal goes BACK to the team.
    expect(goalToTriage(pendingGoal(), ['goal-1'], copy).verdictLabels).toEqual({
      accept: 'Accept',
      reject: 'Send back',
      skip: 'Skip',
    });
  });

  it('carries only the ids a write needs, and NOT a seenStatus it cannot honour', () => {
    const item = goalToTriage(pendingGoal(), ['goal-1'], copy);
    expect(item.payload?.goalId).toBe('goal-1');
    expect(item.payload?.projectId).toBe('proj-1');
    expect(item.payload?.kpiId).toBe('kpi-1');
    // `resolveGoalAcceptance(goalId, decision, comment)` takes no seen-status, so
    // goals have no compare-and-swap. A token nothing reads would advertise a
    // protection this queue does not have.
    expect(item.payload?.seenStatus).toBeUndefined();
  });

  it('names the completion timestamp `raised`, which is what renders it as an age', () => {
    // `TriageFactRow`'s TIME_FACTS is `{'raised','lockedAt'}`. Any other id
    // prints the raw ISO string into the ledger.
    const raised = factById(goalToTriage(pendingGoal(), ['goal-1'], copy).facts, 'raised');
    expect(raised.value).toBe('2026-02-02T00:00:00.000Z');
    expect(raised.label).toBe('Raised');
  });

  it('omits the timestamp fact entirely when the row has no completion stamp', () => {
    const facts = goalToTriage(pendingGoal({ completed_at: null }), ['goal-1'], copy).facts;
    expect(hasFact(facts, 'raised')).toBe(false);
  });
});

describe('goalToTriage — the KPI gauge', () => {
  it('meters current against target when the KPI has a baseline', () => {
    // A fact carrying `score` leaves the ledger and is drawn as a meter by
    // `MetricBadgeRow` — that IS the gauge.
    const progress = factById(goalToTriage(pendingGoal(), ['goal-1'], copy).facts, 'progress');
    expect(progress.value).toBe('34 → 50 %');
    expect(progress.score).toEqual({ value: 34, max: 50, invert: false });
  });

  it('inverts the meter for a KPI where LOWER is better', () => {
    const item = goalToTriage(
      pendingGoal({ kpi_direction: 'down', kpi_current: 120, kpi_target: 80, kpi_baseline: 200 }),
      ['goal-1'],
      copy,
    );
    expect(factById(item.facts, 'progress').score?.invert).toBe(true);
  });

  it('shows the raw range and NO score when the KPI was never baselined', () => {
    // The bug this guards: defaulting a missing baseline forced progress to
    // exactly 0 and painted a precise, fabricated 0% gauge. An unknown starting
    // point is not a starting point of zero.
    const progress = factById(
      goalToTriage(pendingGoal({ kpi_baseline: null }), ['goal-1'], copy).facts,
      'progress',
    );
    expect(progress.value).toBe('34 → 50 %');
    expect(progress.score).toBeUndefined();
  });

  it('drops the unit rather than printing a dangling space', () => {
    const item = goalToTriage(pendingGoal({ kpi_unit: null }), ['goal-1'], copy);
    expect(factById(item.facts, 'progress').value).toBe('34 → 50');
  });

  it('renders no KPI facts at all for a standalone goal', () => {
    const facts = goalToTriage(
      pendingGoal({
        kpi_id: null,
        kpi_name: null,
        kpi_unit: null,
        kpi_current: null,
        kpi_target: null,
        kpi_baseline: null,
        kpi_direction: null,
      }),
      ['goal-1'],
      copy,
    ).facts;
    expect(hasFact(facts, 'kpi')).toBe(false);
    expect(hasFact(facts, 'progress')).toBe(false);
  });
});

describe('goalToTriage — weight', () => {
  it('sits above a routing proposal and below a halted build', () => {
    const met = goalToTriage(pendingGoal({ kpi_current: 60 }), ['goal-1'], copy);
    expect(met.weight).toBe(45);
  });

  it('lifts a goal whose KPI never reached its target', () => {
    // The one worth reading: either the work did not move the number, or the
    // number was the wrong one. Both are conversations.
    const offTrack = goalToTriage(pendingGoal({ kpi_current: 34, kpi_target: 50 }), ['goal-1'], copy);
    const met = goalToTriage(pendingGoal({ kpi_current: 60, kpi_target: 50 }), ['goal-1'], copy);
    expect(offTrack.weight).toBe(60);
    expect(offTrack.weight).toBeGreaterThan(met.weight);
  });

  it('reads a `down` KPI the right way round', () => {
    const met = goalToTriage(
      pendingGoal({ kpi_direction: 'down', kpi_current: 40, kpi_target: 80 }),
      ['goal-1'],
      copy,
    );
    const offTrack = goalToTriage(
      pendingGoal({ kpi_direction: 'down', kpi_current: 120, kpi_target: 80 }),
      ['goal-1'],
      copy,
    );
    expect(met.weight).toBe(45);
    expect(offTrack.weight).toBe(60);
  });

  it('claims nothing about a goal with no KPI to be off', () => {
    const item = goalToTriage(
      pendingGoal({ kpi_id: null, kpi_current: null, kpi_target: null }),
      ['goal-1'],
      copy,
    );
    expect(item.weight).toBe(45);
  });
});

describe('goalToTriage — branches', () => {
  it('does NOT offer a batch when this is the only goal on the KPI', () => {
    // "Accept all 1 from this KPI" is the plain Accept the spine already has.
    const item = goalToTriage(pendingGoal(), ['goal-1'], copy);
    expect(item.branches.map((b) => b.id)).toEqual(['open-board']);
  });

  it('offers the batch with the REAL count once the KPI has siblings', () => {
    const item = goalToTriage(pendingGoal(), ['goal-1', 'goal-2', 'goal-3'], copy);
    const batch = item.branches.find((b) => b.id === 'accept-kpi-batch');
    expect(batch?.label).toBe('Accept all 3 from this KPI');
    // The ids ride as payload: the router has to write every one of them, and
    // adapters are store-free so it cannot go and look them up.
    expect(item.payload?.batchGoalIds).toBe('goal-1,goal-2,goal-3');
  });

  it('never offers a batch to a goal with no KPI to batch by', () => {
    const item = goalToTriage(pendingGoal({ kpi_id: null }), ['goal-1', 'goal-2'], copy);
    expect(item.branches.map((b) => b.id)).toEqual(['open-board']);
    expect(item.payload?.batchGoalIds).toBeUndefined();
  });

  it('always offers the board, which looks rather than writes', () => {
    const board = goalToTriage(pendingGoal(), ['goal-1'], copy).branches.find(
      (b) => b.id === 'open-board',
    );
    expect(board?.label).toBe('Open the goals board');
  });
});

describe('goalToTriage — the send-back reason', () => {
  it('offers presets whose WRITTEN values stay canonical English', () => {
    const localised = { ...copy, reasonNotFinished: 'Noch nicht fertig' };
    const prompt = reasonPromptFor(goalToTriage(pendingGoal(), ['goal-1'], localised), 'reject')!;
    const option = prompt.options.find((o) => o.id === 'not_finished')!;
    expect(option.label).toBe('Noch nicht fertig');
    expect(option.value).toBe('Not finished yet');
  });

  it('accepts free text too, and can be escaped in one keystroke', () => {
    const prompt = reasonPromptFor(goalToTriage(pendingGoal(), ['goal-1'], copy), 'reject')!;
    expect(prompt.on).toBe('reject');
    expect(prompt.freeText).toBe(true);
    expect(prompt.skipLabel).toBe('No reason');
    expect(prompt.options.map((o) => o.value)).toEqual([
      'Not finished yet',
      'No evidence it landed',
      'Missed the KPI target',
      'Needs rework',
    ]);
  });
});
