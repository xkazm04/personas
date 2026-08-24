// The briefing the Ship control bar hands Athena when the operator presses
// "Ask Athena".
//
// WHY A BRIEFING AND NOT A QUESTION. Athena has read ops for projects, contexts
// and canvas islands, but a milestone's live state — which features are in the
// cut, what the automation says about each, which exit criteria are blocking
// and on what evidence — is DERIVED here, in `useShipData`, from signals the
// Factory joins client-side. There is no id she can look up that reconstructs
// it. So the button's job is to put the operator and Athena in front of the
// same screen: everything below is already on it.
//
// WHY IT READS AS AN INSTRUCTION TO HER, NOT AS THE OPERATOR TALKING. It goes
// out through `useAskAthena`, which tags it `system_source: 'Ship'`; the backend
// files it as `TurnOrigin::External` and prepends
// `[Automated request from Ship — not the user]` before she reads a word of it.
// She is being handed a situation, not asked a question — the operator's actual
// question is the message he types next.
//
// WHAT IT DELIBERATELY DOES NOT DO: propose the milestone's contents. The
// operator's ideas arrive vague, and the value of the conversation is her
// pulling them into shape against this state — not her filling the silence with
// a plausible cut he then has to argue with.
import type { DevProject } from '@/lib/bindings/DevProject';

import type { ShipMilestoneVM } from './shipModel';

/** Cap on how many rows of each list reach the briefing. A prompt that carries
 *  a 200-feature backlog is a prompt she skims; the cut and its blockers are
 *  what the conversation is actually about. Truncation is always ANNOUNCED —
 *  a silently-clipped list would have her reason about a scope that is smaller
 *  than the real one and never say so. */
const LIST_CAP = 12;

function capped(lines: string[]): string[] {
  if (lines.length <= LIST_CAP) return lines;
  return [...lines.slice(0, LIST_CAP), `  … and ${lines.length - LIST_CAP} more not listed here`];
}

/**
 * The whole live milestone, as prose she can reason over.
 *
 * `outsidePool` is the features NOT in the core cut — the material any scope
 * conversation draws from. Passing it in rather than reading it off `vm` keeps
 * this function pure over the view model the caller already computed.
 */
export function buildShipBriefing(
  vm: ShipMilestoneVM,
  project: DevProject,
  outsidePool: Array<{ name: string; bucket: string | null; contexts: string[] }>,
): string {
  const core = vm.members.filter((m) => m.bucket === 'core');
  const ready = core.filter((m) => m.feature.ready).length;

  const coreLines = capped(core.map((m) => {
    const bits = [
      `  - ${m.feature.name}`,
      `[${m.feature.stateLabel}]`,
      m.feature.contexts.length > 0 ? `contexts: ${m.feature.contexts.join(', ')}` : 'no context assigned',
      `${m.feature.kpiCount} KPI(s)`,
    ];
    // The operator's own rating is a SECOND OPINION and never a gate — it does
    // not move progress and does not touch the verdict (shipDuality.ts). Say so
    // in the briefing, or she will read a 2/5 as a blocker.
    if (m.rating !== null) bits.push(`operator rates it ${m.rating}/5`);
    if (m.description) bits.push(`operator's note: "${m.description}"`);
    if (m.afterCut) bits.push('JOINED AFTER THE CUT');
    if (m.feature.blocker) bits.push(`blocker: ${m.feature.blocker}`);
    return bits.join(' · ');
  }));

  const outsideLines = capped(outsidePool.map((f) => {
    const where = f.bucket === null ? 'unassigned' : f.bucket;
    const ctx = f.contexts.length > 0 ? ` · ${f.contexts.join(', ')}` : '';
    return `  - ${f.name} (${where})${ctx}`;
  }));

  const critLines = vm.criteria.map((c) => {
    const verdict = c.state === 'go' ? 'MET'
      : c.state === 'warn' ? 'PARTIAL'
      : c.state === 'nogo' ? 'BLOCKING'
      : 'NOT WIRED';
    return `  - ${c.label}: ${verdict} (${c.done}/${c.total}) — ${c.evidence}`;
  });

  const footprintLines = capped(vm.footprint.map((c) => {
    const health = c.tone === 'crit' ? 'CRITICAL' : c.tone === 'warn' ? 'errors this week' : c.tone === 'setup' ? 'no KPI' : 'healthy';
    const errs = c.errors === null ? 'monitoring not wired' : `${c.errors} errors`;
    return `  - ${c.name}: ${health} · ${errs} · ${c.kpis} KPI(s)`;
  }));

  const goalLines = vm.boundGoals.length > 0
    ? vm.boundGoals.map((g) => `  - ${g.name}${g.description ? ` — ${g.description}` : ''}${g.contexts.length > 0 ? ` [${g.contexts.join(', ')}]` : ' [no context]'}`)
    : ['  (none bound — the "objective" exit criterion is unmet until one is)'];

  return [
    `The operator is looking at the Ship tab for the "${project.name}" project (repo root: ${project.root_path}) and opened this conversation from it. Here is exactly what is on his screen.`,
    '',
    `MILESTONE: ${vm.name}`,
    `Objective: ${vm.goal ?? '(not written yet)'}`,
    `Status: ${vm.status}${vm.targetLabel ? ` · ${vm.targetLabel}` : ''}`,
    `Progress: ${vm.progress}% (${ready} of ${core.length} core features read as ready by the automation)`,
    '',
    'BOUND GOALS',
    ...goalLines,
    '',
    `IN THE CUT (${core.length} core features)`,
    ...(coreLines.length > 0 ? coreLines : ['  (empty — nothing is in the cut yet)']),
    '',
    `OUTSIDE THE CUT (${outsidePool.length} available)`,
    ...(outsideLines.length > 0 ? outsideLines : ['  (none — every feature is in the cut)']),
    '',
    `CONTEXT FOOTPRINT (derived from the core cut, ${vm.footprint.length} contexts)`,
    ...(footprintLines.length > 0 ? footprintLines : ['  (empty — the cut touches no mapped context)']),
    '',
    'EXIT CRITERIA (these, and only these, gate certification)',
    ...critLines,
    '',
    `DUALITY: ${vm.duality.agree} agree · ${vm.duality.disagree} disagree · ${vm.duality.unrated} unrated.`,
    vm.duality.conflicts.length > 0
      ? `Where the operator and the automation disagree: ${vm.duality.conflicts.map((c) => `${c.name} (automation says ${c.ready ? 'ready' : 'not ready'}, he rates it ${c.rating}/5)`).join('; ')}. That disagreement is REPORTING ONLY — it never gates the ship verdict.`
      : 'No disagreements between the operator and the automation on this cut.',
    '',
    'HOW TO PLAY THIS',
    '- Open with a SHORT read of where this milestone actually stands and the one thing you would look at first. Two or three sentences. Do not restate the lists above — he is looking at them.',
    '- Then let him talk. He often arrives with a half-formed idea rather than a feature name, and pulling it into shape is the job: ask what outcome he is after, what would count as done, who it is for. Ask ONE question at a time.',
    '- He should never have to know which context, use case or KPI an idea belongs to. That mapping is YOUR work: take the idea, decide which contexts it touches and which goal it serves, and say so — then confirm rather than interrogate.',
    '- An idea with no home yet is a GOAL bound to this milestone, connected to the contexts it touches. Propose it that way.',
    '- When the cut is agreed, act on it: `set_ship_scope` moves members in and out, `show_ship_milestone` proposes a whole new cut, `ship_milestone_lifecycle` cuts or ships. Every one of those is a card he confirms — propose freely, never claim the write landed before he presses it.',
    '- When a criterion is unmet and the gap is real work rather than a scoping decision, offer to put a fleet on it (`show_fleet_plan`) — one session per genuinely separate objective, aimed at this repo.',
    '- Say plainly when you think the cut is wrong or too big. That is the value of being asked.',
  ].join('\n');
}
