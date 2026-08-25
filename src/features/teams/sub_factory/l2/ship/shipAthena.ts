// What the Ship control bar's "Ask Athena" button actually sends.
//
// # Round 1 (2026-08-24) — it stopped pasting the milestone
//
// `buildShipBriefing` rendered the cut, the outside pool, the context
// footprint, every exit criterion with its evidence and the duality conflicts
// into ~100 lines of prose and pushed all of it into the turn. That was a WALL;
// it went stale the instant it was composed; and it taught her to reason from
// the message instead of from the registry. So it became a pointer: who the
// operator is, which milestone, which op reads it.
//
// # Round 2 (2026-08-25) — it stopped telling her what to do
//
// The pointer still carried two things it should not have, and the operator
// named both after a turn where she read a milestone whose description named
// the deliverables, the research to run, the target path and the out-of-scope,
// and then asked him to explain what he meant.
//
//   1. **The VERDICT.** The pointer pasted "the ship verdict is **setup**"
//      because the read op could not see it. She restated that word back as her
//      finding. A conclusion handed to a model before it has read anything is a
//      conclusion it will report as its own. The verdict is now PUBLISHED by
//      this tab (`shipReadinessPublish.ts`) and SERVED by the read op, so it
//      arrives when she asks for it rather than ahead of the question — the
//      same door the Mastermind canvas opened with `mastermind.scene.v1`.
//   2. **THE SCRIPT.** The last paragraph read "help him turn the objective
//      into deliverables. Read it, give him a SHORT read of where the milestone
//      stands and the one thing you would look at first, then let him talk."
//      That names the output shape before the input is known, and "then let him
//      talk" is an instruction to STOP INVESTIGATING — which is why the turn
//      ended in an open question instead of a finding. How she should work a
//      milestone is doctrine and belongs in the constitution, where it is one
//      statement that survives; a per-message script is neither.
//
// So what remains is genuinely a pointer: WHO is looking at WHAT, and nothing
// about what to conclude or how to answer. Everything else is fetched.
import type { DevProject } from '@/lib/bindings/DevProject';

import type { ShipMilestoneVM } from './shipModel';

/**
 * The Ask-Athena message: the operator's location, and the id.
 *
 * Sent through `useAskAthena` tagged `system_source: 'Ship'`, so she is told the
 * surface handed her a situation rather than the operator asking a question —
 * his question is whatever he types next, and what she does about the situation
 * before he types is hers to decide.
 *
 * Deliberately carries NO verdict, NO summary of the cut, and NO instruction
 * about what to say. `describe_ship_milestone` answers all three, live.
 */
export function buildShipAskPrompt(vm: ShipMilestoneVM, project: DevProject): string {
  return [
    `The operator is on the Ship tab for "${project.name}", looking at milestone \`${vm.id}\` ("${vm.name}").`,
    '',
    `Read it with \`describe_ship_milestone\` (query: \`${vm.id}\`) before you say anything about it. That op is the whole picture: the objective and the prose under it, the live exit-criteria verdicts and ship verdict as this tab derived them, the cut by bucket with his notes and ratings, the bound goals, and each member's contexts and KPI coverage.`,
    '',
    // The one thing left worth saying, and it is about STALENESS, not content:
    // he pressed a button, and the milestone may have moved since. Everything
    // else the message used to assert is now something she can go and read.
    'He pressed a button; the milestone is whatever the op says it is now.',
  ].join('\n');
}
