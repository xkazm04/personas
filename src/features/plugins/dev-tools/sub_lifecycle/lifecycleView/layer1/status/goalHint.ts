// Whether a project's last snapshot carried an Overseer goal, remembered
// across sessions, so Layer 1's cold-load ghost can reserve the goal's line in
// the status plate (`Layer1Ghost`) before the snapshot says so: a cold load of
// a project with a goal then moves nothing when the data lands. A hint, not
// data: wrong only for one cold load after a goal appears or goes, and then
// only by the goal line's width, never the plate's height.
//
// Stored as one small list of project ids through the guarded storage door
// (`safeLocalStorage`), newest first and capped.
import { jsonOr, safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

const KEY = 'personas.lifecycle.goalHint';
/** Projects remembered at most; the oldest falls off. */
const CAP = 64;

function read(): string[] {
  const parsed = jsonOr<unknown>(safeLocalGet(KEY, 'lifecycle:goalHint read'), []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
}

/** The project's last snapshot had a goal (as far as this machine remembers). */
export function hadGoal(projectId: string | null): boolean {
  return !!projectId && read().includes(projectId);
}

/** Note what a fresh snapshot said. Writes only when the answer changed. */
export function rememberGoal(projectId: string, hasGoal: boolean): void {
  const ids = read();
  const had = ids.includes(projectId);
  if (had === hasGoal) return;
  const next = hasGoal ? [projectId, ...ids].slice(0, CAP) : ids.filter((id) => id !== projectId);
  safeLocalSet(KEY, JSON.stringify(next), 'lifecycle:goalHint write');
}
