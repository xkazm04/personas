// Dev-runner task popover — opened from the mid band's runner face.
//
// The face answers "how many"; this answers "which tasks, in what state, how
// far along". Rows navigate to the Run Desk (the queue surface that owns the
// full task rows) with this project active — same door discipline as the
// persona popover routing through the Monitor's navigate switch.
import { Cog } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

import { RUNNER_INK } from './farProcesses';
import { ListPopover } from './ListPopover';
import type { RunnerNode } from './types';

export function RunnerListPopover({ rows, x, y, onOpen, onClose }: {
  rows: RunnerNode[];
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  /** Row clicked — the page opens the Run Desk and closes the popover. */
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ListPopover
      title={t.mastermind.family_runners}
      icon={Cog}
      ink={RUNNER_INK}
      trailing={rows.length}
      x={x}
      y={y}
      width={276}
      maxListHeight={240}
      testId="mm-runner-list"
      onClose={onClose}
    >
      {rows.map((task) => {
        const running = task.status === 'running';
        return (
          <li key={task.id}>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-input typo-body transition-colors text-foreground/70 hover:bg-secondary/40 hover:text-foreground focus-ring"
              onClick={() => { onOpen(); onClose(); }}
              data-testid={`mm-runner-row-${task.id}`}
            >
              {/* Hollow dot for queued, filled for running — the same encoding
                  the Tally prototype established for this lane. */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={running
                  ? { background: RUNNER_INK }
                  : { border: `1.5px solid ${RUNNER_INK}`, background: 'transparent' }}
                aria-hidden
              />
              <span className="truncate flex-1">{task.title}</span>
              <span className="typo-caption text-foreground/50 tabular-nums shrink-0">
                {running && task.progress > 0
                  ? `${Math.round(Math.min(task.progress, 100))}%`
                  : tokenLabel(t, 'execution', task.status)}
              </span>
            </button>
          </li>
        );
      })}
    </ListPopover>
  );
}
