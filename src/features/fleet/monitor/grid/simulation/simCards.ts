// simCards — one `PersonaCardModel` per simulated agent, spread across every
// branch the board can paint.
//
// The card is the board's whole vocabulary: `pillarStateKey` folds its counters
// into the four tile states, and `actionBadges` reads five more fields to pick
// the one operation chip a tile carries. So the fixture is written as a
// PROFILE per card — running / failed / input / draft / queued / review /
// message / idle — and the counters are set from the profile rather than rolled
// independently. Rolling each counter on its own produces cards that are
// internally incoherent (a "running" tile advertising a draft it never made)
// and, worse, a distribution nobody chose: the rare states end up rarest
// exactly where a fixture most needs them present.
//
// Every profile appears in the first twenty cards, so a driver that only ever
// looks at the first few columns still sees all four tile colours and all five
// badge kinds.

import type { ManualReviewItem } from '@/lib/types/types';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { PersonaCardModel } from '../../monitorModel';
import type { SimRoster } from './simFleet';
import { chance, int, mulberry32, pick, SEED, type Rand } from './simRandom';

type Profile = 'running' | 'failed' | 'input' | 'draft' | 'queued' | 'review' | 'message' | 'idle';

/**
 * The order the profiles are dealt in. Twenty entries so the cycle does not
 * line up with the three-agents-per-project stride — a period that divided
 * evenly would give every project the same three states in the same order.
 */
const PROFILE_CYCLE: readonly Profile[] = [
  'running', 'idle', 'review', 'failed', 'idle',
  'input', 'running', 'message', 'idle', 'draft',
  'queued', 'idle', 'running', 'review', 'idle',
  'failed', 'message', 'idle', 'running', 'idle',
];

const REVIEW_TITLES: readonly string[] = [
  'Retry policy widened without a bound',
  'Migration drops a column the UI still reads',
  'Secret read straight from the environment',
  'Endpoint answers before the write is durable',
];

const MESSAGE_TITLES: readonly string[] = [
  'Nightly sweep finished — 3 items to look at',
  'Coverage moved: 71% to 78%',
  'Dependency bump needs a decision',
];

function review(personaId: string, i: number, severity: string, now: number, rand: Rand): ManualReviewItem {
  return {
    id: `sim-review-${personaId}-${i}`,
    persona_id: personaId,
    execution_id: `sim-exec-${personaId}-${i}`,
    review_type: 'code_review',
    content: pick(rand, REVIEW_TITLES),
    severity,
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    title: pick(rand, REVIEW_TITLES),
    created_at: new Date(now - int(rand, 5, 400) * 60_000).toISOString(),
    resolved_at: null,
  };
}

function message(personaId: string, i: number, now: number, rand: Rand): PersonaReport {
  return {
    id: `sim-report-${personaId}-${i}`,
    persona_id: personaId,
    execution_id: null,
    title: pick(rand, MESSAGE_TITLES),
    content: pick(rand, MESSAGE_TITLES),
    content_type: 'markdown',
    priority: 'normal',
    is_read: false,
    metadata: null,
    created_at: new Date(now - int(rand, 2, 300) * 60_000).toISOString(),
    read_at: null,
    thread_id: null,
    use_case_id: null,
  };
}

/** The counters and attachments one profile implies. Nothing else sets them. */
function shape(profile: Profile, personaId: string, now: number, rand: Rand): Partial<PersonaCardModel> {
  switch (profile) {
    case 'running':
      return {
        running: int(rand, 1, 3),
        execState: 'running',
        runningSince: now - int(rand, 30, 5_400) * 1_000,
        liveCostUsd: int(rand, 2, 180) / 100,
        liveToolCalls: int(rand, 1, 40),
      };
    case 'failed':
      return { execState: 'failed', recentStatuses: ['failed', 'completed', 'completed'] };
    case 'input':
      return { inputRequired: int(rand, 1, 2), execState: 'attention' };
    case 'draft':
      return { draftReady: int(rand, 1, 3), execState: 'attention' };
    case 'queued':
      return { queued: int(rand, 1, 4), execState: 'attention' };
    case 'review': {
      const severity = pick(rand, ['critical', 'warning', 'info']);
      const reviews = Array.from({ length: int(rand, 1, 4) }, (_, i) => review(personaId, i, severity, now, rand));
      return {
        reviews,
        topReviewSeverity: severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info',
        reviewCounts: {
          critical: severity === 'critical' ? reviews.length : 0,
          warning: severity === 'warning' ? reviews.length : 0,
          info: severity === 'info' ? reviews.length : 0,
        },
        attentionCount: reviews.length,
        execState: 'attention',
      };
    }
    case 'message': {
      const messages = Array.from({ length: int(rand, 1, 3) }, (_, i) => message(personaId, i, now, rand));
      return { messages, attentionCount: messages.length, execState: 'attention' };
    }
    case 'idle':
      return {};
  }
}

/** A card with every field at its "nothing is happening" value. */
function base(personaId: string, personaName: string, color: string | null): PersonaCardModel {
  return {
    personaId,
    personaName,
    personaIcon: null,
    personaColor: color,
    enabled: true,
    reviews: [],
    reviewCounts: { critical: 0, warning: 0, info: 0 },
    topReviewSeverity: null,
    messages: [],
    processes: [],
    running: 0,
    queued: 0,
    inputRequired: 0,
    draftReady: 0,
    runningSince: null,
    execState: 'idle',
    attentionCount: 0,
    healthStatus: null,
    recentStatuses: [],
    successRate: null,
    runsToday: 0,
    totalRecent: 0,
    liveCostUsd: 0,
    liveToolCalls: 0,
  };
}

/**
 * `now` is a parameter, not a `Date.now()` call inside: the elapsed timers and
 * "3h ago" stamps have to be anchored to the wall clock to read correctly, and
 * a fixture that read the clock internally would be deterministic in shape but
 * not in value — which is a distinction a test can only make if the clock is
 * something it can hold still.
 */
export function buildSimCards(roster: SimRoster, now = Date.now()): PersonaCardModel[] {
  const rand = mulberry32(SEED.cards);
  return roster.personas.map((persona, i) => {
    const profile = PROFILE_CYCLE[i % PROFILE_CYCLE.length]!;
    const card = { ...base(persona.id, persona.name, persona.color), ...shape(profile, persona.id, now, rand) };
    // Health is orthogonal to the profile — it rides on recent OUTCOMES, not on
    // what the persona is doing right now, so it is rolled separately.
    const runs = int(rand, 0, 24);
    return {
      ...card,
      runsToday: runs,
      totalRecent: runs,
      successRate: runs === 0 ? null : Math.min(1, int(rand, 55, 100) / 100),
      healthStatus: runs === 0 ? null : chance(rand, 0.15) ? 'degraded' : 'healthy',
    };
  });
}
