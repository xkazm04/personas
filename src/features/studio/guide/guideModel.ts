// Pure model for the Guide layout: Athena's tools and the recommendation deck.
// Every tool and every card is a REAL build turn with a purpose-built prompt;
// nothing here is simulated. Prompts stay English on purpose (they are
// instructions to the model, like StudioQuickActions); labels are translated at
// render time from the ids.
import type { BuildPhase } from '../studioBuildModel';
import type { StudioActivity } from '../studioActivity';

export type GuideToolId = 'research' | 'looks' | 'devices' | 'tour' | 'tweak' | 'data' | 'read';

export interface GuideTool {
  id: GuideToolId;
  /** The turn this tool sends, or null for a tool that does not send a turn. */
  prompt: string | null;
  /** Connectors the turn needs switched on (e.g. the real browser). */
  mcp?: string[];
  /** Phase 2 capability that is not wired yet: shown, but disabled. */
  soon?: boolean;
}

export const GUIDE_TOOLS: GuideTool[] = [
  {
    id: 'research',
    prompt:
      'Research before building the next part: use web search and parallel helpers to look at how the best sites of this kind solve it. Bring back the three findings that should change what we build, in plain words, then update the BUILD_PLAN notes. Do not edit files this turn.',
  },
  {
    id: 'looks',
    prompt:
      'Show me three different looks for the current page: build 2 to 3 visual directions behind a small temporary switcher at the top of the page, same content in each, then ask me A / B / C with NEEDS_INPUT (selector on the page area they differ in most).',
  },
  {
    id: 'devices',
    prompt:
      'Check the site on a phone (360 px), a tablet (768 px) and a desktop (1280 px) in the real browser. Tell me in plain words what looks wrong on each, fix what you can, and say what you fixed.',
    mcp: ['playwright'],
  },
  {
    id: 'tour',
    prompt:
      'Walk me through what you have built so far, section by section from the top of the page. For each part say in one or two plain sentences what it does and which of my decisions shaped it. No code, no file names. Do not edit files this turn.',
  },
  { id: 'tweak', prompt: null, soon: true },
  {
    id: 'data',
    prompt:
      'Help me connect real data instead of placeholders. First ask me with NEEDS_INPUT where the real content lives (options such as: a file on my computer, a spreadsheet, a service I already use, I will type it) and only then wire it up.',
  },
  { id: 'read', prompt: null },
];

export type GuideCardKind = 'continue' | 'refine' | 'devices' | 'tour' | 'research' | 'polish';

export interface GuideCard {
  /** Stable per plan state, so a declined card stays hidden until the plan changes. */
  key: string;
  kind: GuideCardKind;
  /** The goal this card serves (a phase title), for "Serves: ..." */
  goal: string | null;
  prompt: string;
  mcp?: string[];
}

const byStatus = (phases: BuildPhase[], s: string) => phases.filter((p) => p.status === s);

/**
 * Athena's next moves after a finished turn. Derived from the plan and what the
 * last turn did, so every card is grounded in the real project state:
 *  - continue the active goal (or start the next pending one),
 *  - check on devices after a turn that changed the page but never looked at it,
 *  - walk through once something is built, research while a goal is fresh,
 *  - a polish pass once every goal is done.
 */
export function deriveDeck(input: {
  phases: BuildPhase[];
  activity: StudioActivity[];
  dismissed: ReadonlySet<string>;
  placeholder: boolean;
}): GuideCard[] {
  const { phases, activity, dismissed, placeholder } = input;
  const cards: GuideCard[] = [];
  const planKey = phases.map((p) => `${p.id}:${p.status}`).join('|');
  const active = byStatus(phases, 'active')[0];
  const next = byStatus(phases, 'pending')[0];
  const doneCount = byStatus(phases, 'done').length;
  const allDone = phases.length > 0 && doneCount === phases.length;
  const built = activity.some((a) => a.kind === 'build');
  const looked = activity.some((a) => a.kind === 'browser');

  if (placeholder) {
    cards.push({
      key: `plan|${planKey}`,
      kind: 'continue',
      goal: null,
      prompt:
        'Plan it out: propose the build plan (emit your BUILD_PLAN) with a one-line note per goal saying what it will hold, and a 1-2 sentence approach. Do not edit files yet; end with NEEDS_INPUT asking me to approve the plan.',
    });
  } else if (allDone) {
    cards.push({
      key: `polish|${planKey}`,
      kind: 'polish',
      goal: null,
      prompt:
        'Everything in the plan is done. Do a final polish pass as a demanding design lead: empty, loading and error states, spacing rhythm, copy, and anything that would embarrass us in front of the owner. Say what you changed.',
    });
  } else {
    const target = active ?? next;
    if (target) {
      cards.push({
        key: `continue|${target.id}|${planKey}`,
        kind: 'continue',
        goal: target.title,
        prompt: `Keep going on "${target.title}": take it to a solid, real state, then update your BUILD_PLAN. Ask me only if you need a real content or business decision.`,
      });
    }
    if (active && built) {
      cards.push({
        key: `refine|${active.id}|${planKey}`,
        kind: 'refine',
        goal: active.title,
        prompt: `Refine "${active.title}" as a demanding design lead: empty, loading and error states, edge cases, and polish. Say what you changed.`,
      });
    }
  }
  if (built && !looked) {
    cards.push({ key: `devices|${planKey}`, kind: 'devices', goal: active?.title ?? null, prompt: GUIDE_TOOLS[2]!.prompt!, mcp: ['playwright'] });
  }
  if (doneCount > 0) {
    cards.push({ key: `tour|${doneCount}`, kind: 'tour', goal: null, prompt: GUIDE_TOOLS[3]!.prompt! });
  }
  if (!placeholder && (active ?? next)) {
    const g = (active ?? next)!;
    cards.push({
      key: `research|${g.id}|${planKey}`,
      kind: 'research',
      goal: g.title,
      prompt: `Before building "${g.title}", research how the best sites of this kind solve it: use web search and parallel helpers, bring back the three findings that should change what we build, and update the BUILD_PLAN notes. Do not edit files this turn.`,
    });
  }
  return cards.filter((c) => !dismissed.has(c.key)).slice(0, 3);
}

/** The turn that asks Athena to slot a user's new goal into the plan. */
export function addGoalPrompt(goal: string): string {
  return `Add this goal to the plan: "${goal}". Decide where it belongs among the existing goals, say in one sentence where you placed it and why, and emit the updated BUILD_PLAN. Do not start building it yet.`;
}
