// What the Ship control bar's "Ask Athena" button actually sends.
//
// IT USED TO SEND THE WHOLE MILESTONE. `buildShipBriefing` rendered the cut,
// the outside pool, the context footprint, every exit criterion with its
// evidence and the duality conflicts into ~100 lines of prose and pushed all of
// it into the turn. That was wrong in three ways, and the operator named the
// first on 2026-08-24:
//
//   1. It is a WALL. The point of giving her a read op was that she can fetch
//      what she needs; handing her everything up front makes the tool
//      redundant and the turn expensive whether or not the question needed it.
//   2. It goes STALE the instant it is composed. A pasted snapshot describes
//      the milestone as it was when the button was pressed. A tool call
//      describes it now — which matters most in exactly the case this button
//      exists for, a conversation that changes the thing being discussed.
//   3. It taught her to reason from the message instead of from the registry,
//      which is the habit that produces confident answers about stale state.
//
// So this is a POINTER: who the operator is, which milestone, which tool reads
// it, and what he wants done. `describe_ship_milestone` carries the objective
// title, its markdown description, the cut by bucket, the bound goals and the
// per-member readings — everything the briefing used to paste, kept in one
// place and fetched live.
//
// WHAT THE POINTER STILL CARRIES, and why it is not zero: the exit-criteria
// verdicts derive client-side from runtime signals the database cannot see, so
// the read op says plainly that it does not have them. The one line below is
// the honest bridge — it hands her the verdict she would otherwise have to
// guess at, and nothing else.
import type { DevProject } from '@/lib/bindings/DevProject';

import { shipVerdict, type ShipMilestoneVM } from './shipModel';

/** How the overall verdict reads to a human. Mirrors `shipVerdict`'s fold. */
const VERDICT_WORD: Record<ReturnType<typeof shipVerdict>, string> = {
  go: 'all exit criteria met',
  warn: 'some criteria partially met',
  nogo: 'at least one criterion is BLOCKING',
  setup: 'at least one criterion has no sensor or scope wired yet',
};

/**
 * The Ask-Athena message: a pointer at the tool, plus the one reading the tool
 * cannot see.
 *
 * Sent through `useAskAthena` tagged `system_source: 'Ship'`, so she is told the
 * surface handed her a situation rather than the operator asking a question —
 * his question is whatever he types next.
 */
export function buildShipAskPrompt(vm: ShipMilestoneVM, project: DevProject): string {
  const verdict = shipVerdict(vm.criteria);
  const unmet = vm.criteria.filter((c) => c.state !== 'go');

  return [
    `The operator is on the Ship tab for "${project.name}", looking at milestone \`${vm.id}\` ("${vm.name}").`,
    '',
    `Read it with \`describe_ship_milestone\` (query: \`${vm.id}\`) before you say anything about it — that op carries the objective, its description, the cut by bucket, the bound goals, and each member's contexts and KPI coverage, all live.`,
    '',
    // The live half. Named as coming from his screen so she knows why it is
    // here and does not go looking for it in the read op, which says it has no
    // verdicts.
    `From his screen, and NOT available to that op: the ship verdict is **${verdict}** — ${VERDICT_WORD[verdict]}.`,
    unmet.length > 0
      ? `Unmet criteria: ${unmet.map((c) => `${c.label} (${c.done}/${c.total})`).join(' · ')}.`
      : 'Every exit criterion is currently met.',
    '',
    'What he wants from you here: help him turn the objective into deliverables. Read it, give him a SHORT read of where the milestone stands and the one thing you would look at first, then let him talk — he often arrives with a direction rather than a feature name, and pulling it into shape is the job. He must never be asked which context or use case an idea belongs to; that mapping is yours. An idea with no home yet is a GOAL bound to this milestone.',
  ].join('\n');
}
