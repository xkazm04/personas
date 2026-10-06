/**
 * The winner's modal status line, pinned to the bottom of the view: the key
 * mode (NORMAL / MARKED n / MOVE / JUMP), where the cursor is and what it is
 * on, the last change, a real Undo, and the key grammar of the current mode.
 *
 * Key grammar carried over, against the winner's full set:
 *   kept   arrows / h j k l, Home End, g + letter, Space, m, 1-9, 0 (in move),
 *          u, a, Enter, n, z, Esc - every one backed by a real write or by
 *          view state
 *   gone   d (date), [ ] (reorder), > < (nest): the goal API has no write for
 *          a cleared date, the reorder door has no surface that reads its
 *          order, and a goal's parent cannot be changed after creation
 *   gone   / (find) and ? (all keys): `?` is the app's cheat sheet, and the
 *          hints below already list every key of the current mode
 *   gone   redo, reset, the edit counter: edits are real, so the only honest
 *          history is the undo stack of changes that have an exact inverse
 */
import type { ReactNode } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

import { goalStatusLabel, isComplete } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import { bandOfGoal, goalPct, type BusProject } from './busbarModel';
import { Hex, Keycap, shortDay } from './busbarParts';
import type { BusbarState } from './useBusbarState';

type Hint = { keys: string[]; text: string };

export function BusbarStatusLine({ s, projects }: { s: BusbarState; projects: readonly BusProject[] }) {
  const { tx, language } = useTranslation();
  const { dl } = useProgressView();
  const project = s.project;
  const node = project?.row.nodes.find((n) => n.goal.id === s.cursor) ?? null;
  const goal = node?.goal ?? null;
  const band = project && goal ? bandOfGoal(project, goal.id) : null;
  const number = band?.goals.find((g) => g.node.goal.id === goal?.id)?.number ?? 0;

  const marked = s.mode === 'normal' && s.marks.size > 0;
  const modeLabel =
    s.mode === 'move' ? dl.busbar_mode_move
    : s.mode === 'jump' ? dl.busbar_mode_jump
    : marked ? tx(dl.busbar_mode_marked, { count: s.marks.size })
    : dl.busbar_mode_normal;
  const modeCls = s.mode === 'move' ? 'is-move' : s.mode === 'jump' ? 'is-jump' : marked ? 'is-marked' : '';

  const hints: Hint[] =
    s.mode === 'move'
      ? [
          ...(project?.bands ?? [])
            .filter((b) => b.lane)
            .slice(0, 9)
            .map((b) => ({ keys: [String(b.number)], text: b.lane!.name })),
          { keys: ['0'], text: dl.busbar_key_unassign },
          { keys: ['n'], text: dl.busbar_new_milestone },
          { keys: ['Esc'], text: dl.busbar_key_cancel },
        ]
      : s.mode === 'jump'
        ? [
            ...projects.filter((p) => p.letter).map((p) => ({ keys: [p.letter], text: p.row.name })),
            { keys: ['Esc'], text: dl.busbar_key_cancel },
          ]
        : marked
          ? [
              { keys: ['Space'], text: dl.busbar_key_mark },
              { keys: ['m'], text: dl.busbar_key_move },
              { keys: ['1', '9'], text: dl.busbar_key_bind },
              { keys: ['u'], text: dl.busbar_key_unbind },
              { keys: ['Esc'], text: dl.busbar_key_clear },
              { keys: ['z'], text: dl.busbar_key_undo },
            ]
          : [
              { keys: ['←', '→'], text: dl.busbar_key_goal },
              { keys: ['↑', '↓'], text: dl.busbar_key_project },
              { keys: ['g'], text: dl.busbar_key_jump },
              { keys: ['Space'], text: dl.busbar_key_mark },
              { keys: ['m'], text: dl.busbar_key_move },
              { keys: ['1', '9'], text: dl.busbar_key_bind },
              { keys: ['u'], text: dl.busbar_key_unbind },
              { keys: ['a'], text: dl.busbar_key_accept },
              { keys: ['Enter'], text: dl.busbar_key_details },
              { keys: ['n'], text: dl.busbar_new_milestone },
              { keys: ['z'], text: dl.busbar_key_undo },
            ];

  const segs: ReactNode[] = [];
  if (project) segs.push(project.row.name);
  if (goal && project) {
    const done = isComplete(goal.status);
    const day = shortDay(done ? (goal.completed_at ?? goal.target_date) : goal.target_date, language);
    segs.push(tx(dl.busbar_position, { index: project.order.indexOf(goal.id) + 1, total: project.order.length }));
    segs.push(`${goalStatusLabel(dl, goal.status)} ${goalPct(goal)}%`);
    segs.push(band?.lane ? tx(dl.busbar_rail_label, { index: band.number, name: band.lane.name }) : dl.busbar_no_milestone);
    segs.push(day ? `${done ? dl.busbar_finished : dl.busbar_due} ${day}` : dl.progress_no_date);
    const parent = goal.parent_goal_id ? project.row.goals.find((g) => g.id === goal.parent_goal_id) : null;
    if (parent) segs.push(tx(dl.busbar_sub_of, { title: parent.title }));
  }

  return (
    <div className="bb-status" data-testid="busbar-status-line" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
        <span className={`bb-mode ${modeCls} flex items-center gap-2 bb-mono typo-data uppercase`}>
          <Hex ink="currentColor" size={18} fill={0.25} />
          {modeLabel}
        </span>
        <span className="bb-mono typo-data uppercase bb-dim truncate">
          {project?.row.name}
          {band?.lane ? ` › ${band.number}` : ''}
          {number ? ` › #${String(number).padStart(2, '0')}` : ''}
        </span>
        {goal && <span className="typo-heading text-foreground truncate min-w-0 flex-1">{goal.title}</span>}
        {!goal && <span className="flex-1" />}
        {s.notice && <span className="typo-caption truncate max-w-[28rem]">{s.notice}</span>}
        <Button
          variant="secondary"
          size="sm"
          disabled={s.undoDepth === 0}
          onClick={() => void s.undo()}
          data-testid="busbar-undo"
        >
          {dl.busbar_undo}
          <Keycap>z</Keycap>
          {s.undoDepth > 0 && <span className="bb-mono typo-data tabular-nums">{s.undoDepth}</span>}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1.5">
        {segs.length > 0 && (
          <span className="bb-mono typo-data uppercase text-foreground">
            {segs.map((seg, i) => (
              <span key={i} className="bb-seg">{seg}</span>
            ))}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {hints.map((h) => (
            <span key={`${h.keys.join('')}-${h.text}`} className="inline-flex items-center gap-1.5">
              {h.keys.map((k) => (
                <Keycap key={k}>{k}</Keycap>
              ))}
              <span className="typo-caption">{h.text}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
