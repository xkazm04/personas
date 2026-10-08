/**
 * "Break down with Athena" on one goal opened in L2.
 *
 * Modelled on the pad's two pointers (`notepad/athena/buildNoteAskPrompt.ts`)
 * and the Ship decompose request (`notepad/plan/shipAthena.ts`
 * `buildShipDecomposePrompt`), and it keeps their three rules where it can:
 *
 *   1. POINT, do not paste - the MILESTONE is named by id and read with
 *      `describe_ship_milestone`, never summarised here.
 *   2. Name the op, never the answer - how many sub-goals, which ones, whether
 *      any already exist are readings she makes.
 *   3. No reply script - nothing about length, lead or when to stop.
 *
 * The one place rule 1 bends is the GOAL itself: she has no read op for a single
 * dev goal (her catalog writes one with `update_dev_goal` and reads goals only
 * through a milestone's cut), so its title and the operator's description travel
 * in the message. The description is clipped so a long one cannot become the
 * wall the pointer doctrine exists to prevent.
 *
 * What it DOES say is that the card is editable and writes nothing until he
 * presses Create - a proposal she believes is a commitment is one she
 * under-proposes. Without a milestone there is no card to draw (`show_ship_goals`
 * binds to one), so she proposes in the chat instead and creates nothing.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';

/** How much of the goal's description rides in the message. */
export const DESCRIPTION_CLIP = 1200;

export interface GoalBreakdownInput {
  goal: Pick<DevGoal, 'id' | 'title' | 'description' | 'status' | 'progress'>;
  /** The milestone the goal is bound to, or `null` for an unassigned goal. */
  milestone: { id: string; name: string } | null;
  projectName: string;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()} [...]`;
}

export function buildGoalBreakdownPrompt({ goal, milestone, projectName }: GoalBreakdownInput): string {
  const where = milestone
    ? `The operator is on Goals > Progress for "${projectName}", looking at goal \`${goal.id}\` ("${goal.title}") inside milestone \`${milestone.id}\` ("${milestone.name}"), and asked you to break the goal down.`
    : `The operator is on Goals > Progress for "${projectName}", looking at goal \`${goal.id}\` ("${goal.title}"), which is not in any milestone yet, and asked you to break the goal down.`;

  const description = goal.description?.trim()
    ? ['', 'His description of the goal:', '', clip(goal.description, DESCRIPTION_CLIP)]
    : ['', 'The goal has no description; its title is all he wrote.'];

  const state = `It is \`${goal.status}\` with progress ${Math.round(goal.progress)}/100.`;

  const ask = milestone
    ? [
        '',
        `Read the milestone with \`describe_ship_milestone\` (query: \`${milestone.id}\`) first, so you can see which goals are already in the cut and do not propose them again.`,
        '',
        `Then propose the sub-goals with \`show_ship_goals\` (milestone_id: \`${milestone.id}\`). That draws an editable card: he rewrites titles, drops rows, and nothing is written until he presses Create. A title that already exists in the project binds that goal instead of creating a second one.`,
      ]
    : [
        '',
        'There is no milestone to bind them to, so there is no card to draw. Propose the sub-goals in the chat as a list, and create nothing: he decides where they go.',
      ];

  return [where, ...description, '', state, ...ask].join('\n');
}
