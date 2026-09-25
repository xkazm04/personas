/**
 * The operator's lane, as a local fixture.
 *
 * `curator_request` has 0 rows today - nothing has been filed. The door is
 * real (`curatorRequestsList`), and `useLanes` reads it; this fixture is what
 * the variant draws when that read comes back empty, so the surface can be
 * judged full. The skills are the registry's own lane names; the targets are
 * the kind of thing the operator files.
 *
 * ## The same four facts, on this side too
 *
 * A raw intake is a URL. The operator's own idea is a cheap pre-pass (Sonnet
 * Low) that reads each resource once and returns a TOPIC and a HIGH-LEVEL
 * DOMAIN OF IMPACT. That pass does not exist yet, so most rows here are
 * `unknown` on both - which is the honest state of a row seconds after forty
 * links are pasted, and it is NOT an empty string, a dash, or a shimmer.
 *
 * `Fact` is deliberately `CellMark`'s shape in miniature, because the rule is
 * the same rule: a value, a measured absence, an unknown and an unmeasurable
 * are four things. `unmeasurable` is real here and not a hypothetical: a
 * bare-runnable skill (`hygiene`, `librarian`, `harvest` - the three
 * `CuratorSkill.runsBare` names) is filed with NO argument, so there is no
 * resource to read a topic out of. The pre-pass will never answer for it.
 */
import type { CuratorRequestState } from '@/lib/bindings/CuratorRequestState';

/** A fact the enrichment pass can carry, in the page's own four-way vocabulary. */
export type Fact =
  /** The pass ran and returned a value. */
  | { kind: 'known'; value: string }
  /** The pass ran and the resource declares none. */
  | { kind: 'none' }
  /** The pass has not run. Not an empty string. */
  | { kind: 'unknown' }
  /** There is nothing here to read it from. */
  | { kind: 'unmeasurable' };

export interface QueueItem {
  id: string;
  /** The registry skill to run. */
  skill: string;
  /** What to run it on - a URL, a bundle, a domain. Null for a bare-runnable skill. */
  argument: string | null;
  note: string | null;
  state: CuratorRequestState;
  /** Minutes ago it was filed; the row draws its own relative time from this. */
  filedMinutesAgo: number;
  topic: Fact;
  impact: Fact;
  /** The settled row's own last word, verbatim. */
  outcome: string | null;
}

const UNKNOWN: Fact = { kind: 'unknown' };
const UNREADABLE: Fact = { kind: 'unmeasurable' };

export const QUEUE_ITEMS: readonly QueueItem[] = [
  // The last sitting: eleven links pasted in one go, none of them read yet.
  { id: 'q-21', skill: 'intake', argument: 'https://arxiv.org/abs/2509.14021', note: 'looks like it answers judge drift', state: 'queued', filedMinutesAgo: 3, topic: UNKNOWN, impact: UNKNOWN, outcome: null },
  { id: 'q-20', skill: 'intake', argument: 'https://blog.langchain.dev/context-engineering/', note: null, state: 'queued', filedMinutesAgo: 3, topic: UNKNOWN, impact: UNKNOWN, outcome: null },
  { id: 'q-19', skill: 'intake', argument: 'https://simonwillison.net/2026/Sep/12/agent-loops/', note: null, state: 'queued', filedMinutesAgo: 3, topic: UNKNOWN, impact: UNKNOWN, outcome: null },
  { id: 'q-18', skill: 'intake', argument: 'https://www.anthropic.com/engineering/multi-agent-research-system', note: 'compare against fleet-orchestration', state: 'queued', filedMinutesAgo: 4, topic: UNKNOWN, impact: UNKNOWN, outcome: null },
  { id: 'q-17', skill: 'harvest', argument: null, note: 'drain the 268 rows in its own queue', state: 'queued', filedMinutesAgo: 9, topic: UNREADABLE, impact: UNREADABLE, outcome: null },
  { id: 'q-16', skill: 'forge', argument: 'agent-operations/run-cost-attribution', note: 'no subject covers this yet', state: 'queued', filedMinutesAgo: 22, topic: { kind: 'known', value: 'Run cost attribution' }, impact: { kind: 'known', value: 'agent-operations' }, outcome: null },
  { id: 'q-15', skill: 'conform', argument: 'personas-web', note: null, state: 'queued', filedMinutesAgo: 26, topic: { kind: 'known', value: 'Marketing site conformance' }, impact: { kind: 'known', value: 'software-engineering' }, outcome: null },

  // In flight.
  { id: 'q-14', skill: 'intake', argument: 'https://research.google/blog/speculative-decoding-at-scale/', note: null, state: 'dispatched', filedMinutesAgo: 41, topic: { kind: 'known', value: 'Speculative decoding at scale' }, impact: { kind: 'known', value: 'software-engineering' }, outcome: null },
  { id: 'q-13', skill: 'deepen', argument: 'localization/translation-quality-measurement', note: 'it is at 3 techniques', state: 'dispatched', filedMinutesAgo: 55, topic: { kind: 'known', value: 'Translation quality measurement' }, impact: { kind: 'known', value: 'localization' }, outcome: null },

  // Settled.
  { id: 'q-12', skill: 'librarian', argument: null, note: null, state: 'landed', filedMinutesAgo: 190, topic: UNREADABLE, impact: UNREADABLE, outcome: '471 subjects swept, 19 worklist rows' },
  { id: 'q-11', skill: 'intake', argument: 'https://openai.com/index/gpt-5-system-card/', note: null, state: 'landed', filedMinutesAgo: 240, topic: { kind: 'known', value: 'Model system card' }, impact: { kind: 'known', value: 'llm-observability' }, outcome: 'folded into judge-calibration-and-drift' },
  { id: 'q-10', skill: 'intake', argument: 'https://news.ycombinator.com/item?id=41988103', note: 'the comments, not the link', state: 'declined', filedMinutesAgo: 300, topic: { kind: 'none' }, impact: { kind: 'none' }, outcome: 'a comment thread is not a source the corpus can cite' },
  { id: 'q-09', skill: 'apply', argument: 'software-engineering/credential-vault', note: null, state: 'landed', filedMinutesAgo: 420, topic: { kind: 'known', value: 'Credential vault' }, impact: { kind: 'known', value: 'security' }, outcome: 'reconciled, 1 deviation recorded' },
  { id: 'q-08', skill: 'intake', argument: 'https://paper.example.invalid/dead-link', note: null, state: 'failed', filedMinutesAgo: 480, topic: UNKNOWN, impact: UNKNOWN, outcome: 'fetch failed: host did not resolve' },
  { id: 'q-07', skill: 'reconcile', argument: 'llm-observability', note: 'after the price book moved', state: 'cancelled', filedMinutesAgo: 1440, topic: { kind: 'known', value: 'Price book move' }, impact: { kind: 'known', value: 'llm-observability' }, outcome: 'superseded by q-11' },
];
