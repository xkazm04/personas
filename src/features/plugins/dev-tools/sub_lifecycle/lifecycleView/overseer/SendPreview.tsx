/**
 * The body of the Send confirm: exactly what "Send to Overseer" will do, from
 * the backend's dry run (`previewModel`). Each group is a head in its own tone
 * and glyph ("Will file 3 items", "Will reopen 1 item (regressed)", "Already
 * with him: 1", "Left alone: 1") over ONE line per step: its verdict's glyph
 * and word in the verdict's ink, its name, and why (truncated; the whole of it
 * on hover), so a long dry run still fits the confirm without scrolling.
 * Steps with nothing to do are one quiet count at the foot.
 *
 * While the dry run is read, the body is a ghost of three rows in the rows'
 * own geometry; a failed read is said here, and the confirm can still send.
 */
import { Ban, CircleCheck, CircleDot, FilePlus2, RotateCcw, type LucideIcon } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { VERDICT } from '../layer1/healthModel';
import { HEALTH_GLYPH, healthLabel, reasonLine } from '../layer1/layer1Labels';
import { GhostLine } from '../system/GhostLine';
import { LT } from '../system/lcType';
import { itemStatusLabel } from '../system/Pill';
import { GLYPH } from '../system/scales';
import { previewPlan, type PreviewGroup, type PreviewGroupKind, type PreviewRow } from './previewModel';
import type { PreviewState } from './useOverseerHandoff';

const GROUP_LOOK: Record<PreviewGroupKind, { glyph: LucideIcon; ink: string }> = {
  file: { glyph: FilePlus2, ink: 'text-role-agent' },
  reopen: { glyph: RotateCcw, ink: 'text-status-warning' },
  open: { glyph: CircleDot, ink: 'text-status-info' },
  decided: { glyph: Ban, ink: 'text-foreground' },
};

function useGroupHead() {
  const { dl, tx } = useLifecycleViewModel();
  return (g: PreviewGroup): string => {
    const count = g.rows.length;
    switch (g.kind) {
      case 'file': return count === 1 ? dl.lcx9_preview_file_one : tx(dl.lcx9_preview_file, { count });
      case 'reopen': return count === 1 ? dl.lcx9_preview_reopen_one : tx(dl.lcx9_preview_reopen, { count });
      case 'open': return tx(dl.lcx9_preview_open, { count });
      case 'decided': return tx(dl.lcx9_preview_decided, { count });
    }
  };
}

function Row({ row, kind }: { row: PreviewRow; kind: PreviewGroupKind }) {
  const { dl, tx, order } = useLifecycleViewModel();
  const node = order.find((n) => n.id === row.stepId);
  const v = VERDICT[row.health];
  const Glyph = HEALTH_GLYPH[row.health];
  const why = kind === 'decided'
    ? row.itemStatus ? tx(dl.lcx9_preview_decided_reason, { status: itemStatusLabel(dl, row.itemStatus).toLowerCase() }) : dl.lcx9_preview_decided_any
    : reasonLine(dl, row.health, row.reason);
  return (
    <li className="flex min-w-0 items-center gap-2" data-step={row.stepId} data-health={row.health} data-testid={`lc9-preview-row-${row.stepId}`}>
      <Glyph className={`${GLYPH.sm} shrink-0 ${v.ink}`} aria-hidden />
      <span className={`shrink-0 ${LT.row}`}>{stepLabel(dl, row.stepId, node?.label ?? null)}</span>
      <span className={`shrink-0 ${LT.label} ${v.ink}`}>{healthLabel(dl, row.health)}</span>
      {why && (
        <Tooltip content={why}>
          <span className={`min-w-0 flex-1 truncate ${LT.meta}`} data-why>{why}</span>
        </Tooltip>
      )}
    </li>
  );
}

function Group({ group }: { group: PreviewGroup }) {
  const head = useGroupHead();
  const look = GROUP_LOOK[group.kind];
  const Glyph = look.glyph;
  return (
    <section className="flex flex-col gap-1.5" data-group={group.kind}>
      <h3 className={`flex items-center gap-1.5 ${LT.label} ${look.ink}`}>
        <Glyph className={`${GLYPH.sm} shrink-0`} aria-hidden />
        {head(group)}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {group.rows.map((r) => <Row key={r.stepId} row={r} kind={group.kind} />)}
      </ul>
    </section>
  );
}

function PreviewGhost() {
  const { dl } = useLifecycleViewModel();
  return (
    <div className="flex flex-col gap-3" data-testid="lc9-preview-ghost">
      <span className="sr-only">{dl.lcx9_preview_loading}</span>
      <GhostLine role="meta" width="80%" />
      <span aria-hidden className="flex flex-col gap-1.5">
        <GhostLine role="label" width="40%" />
        {[0, 1, 2].map((i) => <GhostLine key={i} role="row" width={`${88 - i * 14}%`} />)}
      </span>
    </div>
  );
}

export function SendPreview({ state }: { state: PreviewState }) {
  const { dl, tx, snapshot } = useLifecycleViewModel();
  if (state.phase === 'loading') return <PreviewGhost />;
  if (state.phase === 'error') {
    return <p role="alert" className={`${LT.row} text-status-error`} data-testid="lc9-preview-error">{tx(dl.lcx9_preview_failed, { error: state.message })}</p>;
  }
  const plan = previewPlan(state.preview, snapshot?.goal ?? null);
  return (
    <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1" data-testid="lc9-preview">
      <p className={LT.meta}>{plan.newGoal ? dl.lcx9_preview_goal_new : dl.lcx9_preview_goal_open}</p>
      {plan.nothingNew && <p className={LT.row} data-testid="lc9-preview-nothing">{dl.lcx9_preview_nothing}</p>}
      {plan.groups.map((g) => <Group key={g.kind} group={g} />)}
      {plan.healthy > 0 && (
        <p className={`flex items-center gap-1.5 ${LT.meta}`} data-testid="lc9-preview-healthy">
          <CircleCheck className={`${GLYPH.sm} shrink-0 text-status-success`} aria-hidden />
          {plan.healthy === 1 ? dl.lcx9_preview_healthy_one : tx(dl.lcx9_preview_healthy, { count: plan.healthy })}
        </p>
      )}
    </div>
  );
}
