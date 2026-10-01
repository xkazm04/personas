/**
 * Blueprint fixtures (spark twin-portable-blueprint, WP0): three twins at the
 * edges a renderer must survive - a brand-new empty twin, a one-channel twin,
 * and a rich twin with nine channels and a full plan - plus the two delta
 * phases. Used by variant tests and the page harness (`twin/blueprint/*`).
 * Test data only: never imported by product code.
 */
import { tierForCount } from '../../sub_training/topicCoverage';
import type { BlueprintDelta, BlueprintTopic, TwinBlueprintModel } from '../blueprintContract';

const topics = (counts: Array<[number, number]>): BlueprintTopic[] =>
  (['background', 'opinions', 'communication', 'values', 'expertise', 'personal'] as const).map((id, i) => {
    const [approved, awaiting] = counts[i] ?? [0, 0];
    return { id, approved, awaiting, tier: tierForCount(approved) };
  });

/** Just forged: a name, nothing else. */
export const FIXTURE_EMPTY: TwinBlueprintModel = {
  twinId: 'fx-empty',
  identity: { name: 'Ada', role: null, bioChars: null, bioTarget: 50, languages: [] },
  voice: { channels: [{ channel: 'generic', exemplars: 0, rules: 0, hasDirectives: false, dims: null, origin: null }] },
  knowledge: { memories: { approved: 0, pending: 0, rejected: 0 }, facts: 0, kbBound: false },
  training: { topics: topics([]), goals: [], answered: 0, kindMix: {}, observations: 0, lastTrainedAt: null },
  readiness: { score: 5, slots: { identity: 'partial', tone: 'empty', channels: 'empty', memories: 'empty' } },
  samples: { open: 0 },
};

/** One voiced channel, a short plan, a few answers. */
export const FIXTURE_ONE_CHANNEL: TwinBlueprintModel = {
  twinId: 'fx-one',
  identity: { name: 'Marek', role: 'Engineering lead', bioChars: 212, bioTarget: 50, languages: ['cs', 'en'] },
  voice: {
    channels: [
      {
        channel: 'generic',
        exemplars: 2,
        rules: 3,
        hasDirectives: true,
        dims: { formality: 3, warmth: 3, humor: 2, energy: 3, length: 2, directness: 4, expressiveness: 2, detail: 3 },
        origin: 'preset',
      },
    ],
  },
  knowledge: { memories: { approved: 4, pending: 3, rejected: 1 }, facts: 2, kbBound: false },
  training: {
    topics: topics([[2, 1], [1, 2], [0, 0], [0, 0], [3, 0], [0, 0]]),
    goals: [
      { id: 'g1', slot: 'identity', title: 'Who Marek is at work', coverage: 0.9, answered: 4, state: 'covered', lastWhy: null },
      { id: 'g2', slot: 'tone', title: 'How Marek writes by default', coverage: 0.55, answered: 3, state: 'open', lastWhy: 'Short, direct replies with no greeting.' },
      { id: 'g7', slot: 'training:opinions', title: 'How Marek argues a position', coverage: 0.2, answered: 2, state: 'open', lastWhy: null },
    ],
    answered: 9,
    kindMix: { scene: 3, opinion: 2, reply_drill: 2, fact: 2 },
    observations: 2,
    lastTrainedAt: '2026-09-30T18:20:00Z',
  },
  readiness: { score: 48, slots: { identity: 'set', tone: 'partial', channels: 'empty', memories: 'partial' } },
  samples: { open: 2 },
};

const dims = (f: number, w: number, h: number, e: number, l: number, d: number, x: number, t: number) => ({
  formality: f, warmth: w, humor: h, energy: e, length: l, directness: d, expressiveness: x, detail: t,
});

/** Nine channels, a full plan, a long history: the overflow test. */
export const FIXTURE_RICH: TwinBlueprintModel = {
  twinId: 'fx-rich',
  identity: { name: 'Kristýna Nováková-Svobodová', role: 'Head of Partnerships, Central Europe', bioChars: 640, bioTarget: 50, languages: ['cs', 'en', 'de', 'sk'] },
  voice: {
    channels: [
      { channel: 'generic', exemplars: 6, rules: 8, hasDirectives: true, dims: dims(3, 4, 2, 3, 3, 3, 3, 3), origin: 'learned' },
      { channel: 'email', exemplars: 9, rules: 6, hasDirectives: true, dims: dims(4, 3, 1, 3, 3, 3, 2, 4), origin: 'learned' },
      { channel: 'slack', exemplars: 4, rules: 3, hasDirectives: true, dims: dims(2, 4, 3, 4, 2, 4, 3, 2), origin: 'rolled' },
      { channel: 'teams', exemplars: 1, rules: 2, hasDirectives: true, dims: dims(2, 4, 2, 3, 2, 3, 3, 2), origin: 'preset' },
      { channel: 'discord', exemplars: 0, rules: 0, hasDirectives: false, dims: null, origin: null },
      { channel: 'telegram', exemplars: 2, rules: 1, hasDirectives: true, dims: dims(2, 5, 3, 4, 1, 3, 4, 2), origin: 'preset' },
      { channel: 'whatsapp', exemplars: 3, rules: 1, hasDirectives: false, dims: null, origin: 'manual' },
      { channel: 'sms', exemplars: 0, rules: 2, hasDirectives: true, dims: dims(2, 3, 2, 3, 1, 4, 2, 1), origin: 'preset' },
      { channel: 'voice', exemplars: 0, rules: 0, hasDirectives: true, dims: dims(3, 4, 2, 3, 1, 3, 1, 1), origin: 'preset' },
    ],
  },
  knowledge: { memories: { approved: 57, pending: 12, rejected: 9 }, facts: 31, kbBound: true },
  training: {
    topics: topics([[9, 1], [6, 2], [7, 0], [4, 3], [12, 1], [1, 0]]),
    goals: [
      { id: 'g1', slot: 'identity', title: 'Her role and what she is accountable for', coverage: 1, answered: 6, state: 'covered', lastWhy: null },
      { id: 'g2', slot: 'tone', title: 'Email voice with partners she has never met', coverage: 0.82, answered: 7, state: 'open', lastWhy: 'Opens with the ask, closes with one concrete next step.' },
      { id: 'g3', slot: 'channels', title: 'When she moves a thread from email to a call', coverage: 0.4, answered: 3, state: 'open', lastWhy: null },
      { id: 'g4', slot: 'memories', title: 'Standing commitments and recurring meetings', coverage: 0.65, answered: 5, state: 'open', lastWhy: null },
      { id: 'g5', slot: 'training:opinions', title: 'Where she disagrees with the sales playbook', coverage: 0.3, answered: 4, state: 'open', lastWhy: 'Took a clear side and gave a reason from a real deal.' },
      { id: 'g6', slot: 'training:expertise', title: 'Contract terms she negotiates every quarter', coverage: 0.92, answered: 9, state: 'covered', lastWhy: null },
      { id: 'g7', slot: 'training:values', title: 'What she will not promise a partner', coverage: 0.15, answered: 1, state: 'open', lastWhy: null },
      { id: 'g8', slot: 'training:personal', title: 'Anything outside work she brings into conversation', coverage: 0, answered: 0, state: 'dropped', lastWhy: null },
    ],
    answered: 64,
    kindMix: { scene: 18, opinion: 11, reply_drill: 14, fact: 9, rule: 7, preference: 5 },
    observations: 11,
    lastTrainedAt: '2026-10-01T07:45:00Z',
  },
  readiness: { score: 92, slots: { identity: 'set', tone: 'set', channels: 'set', memories: 'set' } },
  samples: { open: 5 },
};

/** The moment an answer is given (topic + kind known, gain not yet). */
export const FIXTURE_DELTA_INSTANT: BlueprintDelta = {
  answeredStepId: 's-41',
  phase: 'instant',
  topicId: 'opinions',
  kind: 'opinion',
  goalId: 'g5',
  coverageGain: null,
  why: null,
  channel: null,
};

/** The same answer once the reconcile pass has scored it. */
export const FIXTURE_DELTA_RECONCILED: BlueprintDelta = {
  ...FIXTURE_DELTA_INSTANT,
  phase: 'reconciled',
  coverageGain: 0.12,
  why: 'Took a clear side and gave a reason from a real deal.',
};
