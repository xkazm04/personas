import type { RowView } from '../../model/types';
import { BRIEFING } from './copy';
import { plural } from './rich';

const M = BRIEFING.movement;

/**
 * Today's movement on a project as one plain clause, from the away log on the
 * row: "9 commits, 13 pushes, 4 dispatches today". Commits are the report's
 * count since the last standup; the rest are the away acts by kind.
 */
export function movementClause(row: RowView): string {
  const by = (kind: string) => row.pastMarks.filter((m) => m.kind === kind).length;
  const parts: string[] = [];
  if (row.moved > 0) parts.push(plural(row.moved, M.commits, M.commit));
  const pushes = by('push');
  const dispatches = by('dispatch');
  const asks = by('ask_parked');
  if (pushes > 0) parts.push(plural(pushes, M.pushes, M.push));
  if (dispatches > 0) parts.push(plural(dispatches, M.dispatches, M.dispatch));
  if (asks > 0) parts.push(plural(asks, M.asks, M.ask));
  if (parts.length === 0) return M.none;
  return M.today.replace('{list}', parts.join(', '));
}
