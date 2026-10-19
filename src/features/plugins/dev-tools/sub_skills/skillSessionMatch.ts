// "Is this Fleet session running that skill, in that repo?" - one answer for
// every Skills surface.
//
// The Launch tab, the workspace Registry matrix and the project Registry matrix
// each kept their own copy of the live-state set and the path normaliser, and
// the two Registry copies matched the skill on the FIRST arg only. A session
// Athena dispatched from the Launch tab carries `/skill ...` in a later arg, so
// the Launch tab showed it running while both matrices offered to adopt or
// dispatch the same skill into the same repo again.
import { parseSkillArg } from './analytics/useSkillsAnalytics';

/** Fleet states that mean the session is still doing work. */
export const LIVE_STATES = new Set(['spawning', 'running', 'awaiting_input']);

/** Normalize a path for cwd <-> root matching. */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * Does this session's arg vector invoke the skill? Primary: the first arg is
 * the `/skill ...` slash command (parseSkillArg). Secondary: ANY arg equals
 * `/skill` or contains `/skill ` - Athena-dispatched sessions carry the same
 * /skill arg shape but not necessarily in first position.
 */
export function argsInvokeSkill(args: string[], skill: string): boolean {
  if (parseSkillArg(args)?.skill === skill) return true;
  const token = `/${skill}`;
  return args.some((a) => a === token || a.includes(`${token} `));
}

/** Is this session a live run of `skill` inside `projectRoot`? */
export function sessionRunsSkill(
  session: { args: string[]; cwd: string; state: string },
  skill: string,
  projectRoot: string,
): boolean {
  if (!LIVE_STATES.has(session.state)) return false;
  if (normPath(session.cwd) !== normPath(projectRoot)) return false;
  return argsInvokeSkill(session.args, skill);
}

/** The skills among `names` a live session is running (any cwd - the caller
 *  maps the cwd to its own column). Empty for a finished session. */
export function skillsRunBy(
  session: { args: string[]; state: string },
  names: Iterable<string>,
): string[] {
  if (!LIVE_STATES.has(session.state)) return [];
  const out: string[] = [];
  for (const n of names) if (argsInvokeSkill(session.args, n)) out.push(n);
  return out;
}
