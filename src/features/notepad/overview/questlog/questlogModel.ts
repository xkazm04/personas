// Pure model for the journal desk (Quest Log). No React, no DOM, no stores —
// the column partition and the run grouping live here so the tests can pin them
// without mounting the pad. Anything the DOM knows (a zone's measured height,
// the container's width) is measured by the caller and passed IN, exactly as
// `deskModel.ts` does for the card desk.
//
// The design this implements, and why each rule exists, is in
// `.contest/prototype/goal-map/NOTES.md` (approach B). The two defects it
// answers, both measured on the card desk at 90 goals across 16 projects:
// a flat grid is 23 rows of scroll, and a layout that re-sorts by weight moves
// 16 of 17 groups every time the filter changes, so nothing can be learned by
// position.
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import { NOTE_PLAN_STATUSES } from '../../noteStatusMeta';

/** A project's seat on the desk. `null` id is the "no project" zone. */
export interface QuestZone {
  /** The project id, or `PROJECT_NONE` for the unmapped bucket. */
  id: string;
  name: string;
  /** True for the unmapped bucket, which renders in italic and sorts last. */
  none: boolean;
  /** Every goal in this zone, in rail order. Never filtered by the rail lens —
   *  the lens dims, it does not remove (see `railLens`). */
  goals: DevNote[];
}

/** Which of the two rails a status belongs to. `draft` is shared: it is where
 *  both rails start, so it can never be drawn as belonging to one of them. */
export type NoteRail = 'plan' | 'brainstorm' | 'shared';

export function railOf(status: NoteStatus): NoteRail {
  if (status === 'draft') return 'shared';
  return NOTE_PLAN_STATUSES.includes(status) ? 'plan' : 'brainstorm';
}

/**
 * Reading order inside a zone: the plan rail first (it is the committed work),
 * then the shared draft state, then the brainstorm rail. Within one status the
 * pad's own `orderIndex` decides, so a goal never moves for a reason the
 * operator cannot see.
 */
const RAIL_ORDER: readonly NoteStatus[] = [
  'scoped', 'cut', 'shipped',
  'draft',
  'published', 'in_progress', 'completed',
];

export function compareInZone(a: DevNote, b: DevNote): number {
  const d = RAIL_ORDER.indexOf(a.status) - RAIL_ORDER.indexOf(b.status);
  return d !== 0 ? d : a.orderIndex - b.orderIndex;
}

/**
 * Build the zones, in the order they are read: alphabetically by project name,
 * case-insensitively, with the unmapped bucket last.
 *
 * THE ORDER IS THE POINT. It is derived from the project's NAME and nothing
 * else — not from how many goals it holds, not from how urgent they are, not
 * from what the rail filter admits. A zone therefore keeps its seat across
 * every filter change, every dispatch and every new goal, and the operator can
 * learn where a project lives. The card desk's grid re-sorts on each change,
 * which is why it cannot be navigated from memory.
 */
export function buildZones(
  notes: readonly DevNote[],
  projects: readonly { id: string; name: string }[],
  noneLabel: string,
): QuestZone[] {
  const byProject = new Map<string, DevNote[]>();
  for (const note of notes) {
    const key = note.projectId ?? '';
    const list = byProject.get(key);
    if (list) list.push(note);
    else byProject.set(key, [note]);
  }

  const zones: QuestZone[] = [];
  for (const project of projects) {
    const goals = byProject.get(project.id);
    if (!goals || goals.length === 0) continue;
    zones.push({ id: project.id, name: project.name, none: false, goals: [...goals].sort(compareInZone) });
  }
  zones.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const unmapped = byProject.get('');
  if (unmapped && unmapped.length > 0) {
    zones.push({ id: PROJECT_NONE, name: noneLabel, none: true, goals: [...unmapped].sort(compareInZone) });
  }
  return zones;
}

/** The id the unmapped zone carries. Shared with `deskModel`'s filter vocabulary. */
export const PROJECT_NONE = '__none';

/**
 * A run of consecutive goals sharing one status. The first carries the status
 * glyph; the rest carry a wire, so eleven scoped goals read as one bracket
 * rather than eleven identical icons. A run never spans a rail boundary —
 * `railOf` differs, so the status differs, so the run is already broken.
 */
export interface QuestRun {
  status: NoteStatus;
  rail: NoteRail;
  goals: DevNote[];
  /** True when a rail boundary closes ABOVE this run and the renderer should
   *  spend a hairline of space on it. */
  breakBefore: boolean;
}

export function groupRuns(goals: readonly DevNote[]): QuestRun[] {
  const runs: QuestRun[] = [];
  for (const goal of goals) {
    const last = runs[runs.length - 1];
    if (last && last.status === goal.status) {
      last.goals.push(goal);
      continue;
    }
    const rail = railOf(goal.status);
    runs.push({
      status: goal.status,
      rail,
      goals: [goal],
      // The gap marks the moment the plan rail hands over, which is the one
      // structural boundary inside a zone.
      breakBefore: Boolean(last && last.rail === 'plan' && rail !== 'plan'),
    });
  }
  return runs;
}

/**
 * Contiguous linear partition: split `heights` into `columns` consecutive
 * groups so the tallest group is as short as possible.
 *
 * CONSECUTIVE is the constraint that makes this the right algorithm. The
 * alphabet must survive the layout — a partition that reordered zones to pack
 * them better would buy a few pixels and cost the whole reason the order is
 * alphabetical. So the only freedom is where the column breaks fall.
 *
 * O(columns x n^2), on at most a few dozen zones. Returns `[start, end)` pairs.
 */
export function partitionColumns(
  heights: readonly number[],
  columns: number,
): { groups: [number, number][]; tallest: number } {
  const n = heights.length;
  const k = Math.max(1, Math.min(columns, Math.max(1, n)));
  if (n === 0) return { groups: [], tallest: 0 };

  const prefix = [0];
  for (const h of heights) prefix.push(prefix[prefix.length - 1]! + h);

  // best[j][i] = the tallest column when the first i zones fill j columns.
  const best: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0]![0] = 0;

  for (let j = 1; j <= k; j += 1) {
    for (let i = 1; i <= n; i += 1) {
      for (let s = j - 1; s < i; s += 1) {
        const value = Math.max(best[j - 1]![s]!, prefix[i]! - prefix[s]!);
        if (value < best[j]![i]!) {
          best[j]![i] = value;
          cut[j]![i] = s;
        }
      }
    }
  }

  const groups: [number, number][] = [];
  let i = n;
  for (let j = k; j > 0; j -= 1) {
    const s = cut[j]![i]!;
    groups.unshift([s, i]);
    i = s;
  }
  return { groups, tallest: best[k]![n]! };
}

/** How many columns a width affords. Two is the floor: one column is a list, and
 *  a list is the thing this layout exists to stop being. */
export function columnsForWidth(width: number, min = 2, max = 5, per = 390): number {
  if (!Number.isFinite(width) || width <= 0) return min;
  return Math.max(min, Math.min(max, Math.floor(width / per)));
}

/**
 * The fit ladder, tried in order until the tallest column fits.
 *
 * `lines` gives every goal its own row. `runs` folds a status run into one
 * flowing sentence — every title still whole, separated by a middot — which is
 * what buys the last of the height. **Nothing below 12px**: the app's floor,
 * and the reason the ladder ends where it does rather than shrinking until it
 * fits. When even the last step overflows, the column scrolls and names what is
 * below (see `QuestBelow`), which is a better answer than silent truncation.
 */
export interface FitStep {
  mode: 'lines' | 'runs';
  /** rem */
  fontSize: string;
  lineHeight: number;
  /** px */
  gap: string;
}

export const FIT_STEPS: readonly FitStep[] = [
  { mode: 'lines', fontSize: '0.8125rem', lineHeight: 1.45, gap: '10px' },
  { mode: 'lines', fontSize: '0.78125rem', lineHeight: 1.36, gap: '8px' },
  { mode: 'lines', fontSize: '0.75rem', lineHeight: 1.36, gap: '7px' },
  { mode: 'runs', fontSize: '0.8125rem', lineHeight: 1.4, gap: '8px' },
  { mode: 'runs', fontSize: '0.78125rem', lineHeight: 1.36, gap: '7px' },
  { mode: 'runs', fontSize: '0.75rem', lineHeight: 1.34, gap: '6px' },
  { mode: 'runs', fontSize: '0.75rem', lineHeight: 1.28, gap: '5px' },
];

/** Is this goal past the target date its milestone declared? Absence is not
 *  lateness — a goal with no target date is never late, it is unscheduled. */
export function isLate(targetDate: string | null | undefined, status: NoteStatus, today = new Date()): boolean {
  if (!targetDate || status === 'shipped' || status === 'completed') return false;
  const due = Date.parse(`${targetDate}T23:59:59Z`);
  return Number.isFinite(due) && due < today.getTime();
}

/** Whole days past the target date, floored at 1 so "0d late" can never render. */
export function lateDays(targetDate: string, today = new Date()): number {
  const due = Date.parse(`${targetDate}T23:59:59Z`);
  if (!Number.isFinite(due)) return 1;
  return Math.max(1, Math.round((today.getTime() - due) / 86_400_000));
}

/** Which column holds this zone, given the partition. */
export function columnOf(groups: readonly [number, number][], index: number): number {
  for (let c = 0; c < groups.length; c += 1) {
    const [start, end] = groups[c]!;
    if (index >= start && index < end) return c;
  }
  return 0;
}

/**
 * Move the cursor across the grid of zones.
 *
 * Vertical movement walks the column and stops at its ends — a column is a
 * physical stack, and wrapping from its foot to its head would lose the
 * operator. Horizontal movement steps to the neighbouring column and lands at
 * the same relative depth, which is the closest a pure function can get to
 * "the zone beside this one" without reading the DOM.
 *
 * Returns the new index, or `null` when the move is refused.
 */
export function moveZone(
  groups: readonly [number, number][],
  index: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): number | null {
  if (groups.length === 0) return null;
  const column = columnOf(groups, index);
  const [start, end] = groups[column]!;

  if (dy !== 0) {
    const next = index + dy;
    return next >= start && next < end ? next : null;
  }
  if (dx === 0) return null;

  const target = groups[column + dx];
  if (!target) return null;
  const [start2, end2] = target;
  const span = Math.max(1, end - start - 1);
  const span2 = Math.max(0, end2 - start2 - 1);
  return start2 + Math.round(((index - start) / span) * span2);
}

/** Walk the zone list alphabetically. Used by `[` and `]`, which is the one
 *  movement that ignores the column geometry entirely. */
export function stepZone(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current ? ids.indexOf(current) : -1;
  if (at < 0) return ids[delta > 0 ? 0 : ids.length - 1]!;
  return ids[(at + delta + ids.length) % ids.length]!;
}
