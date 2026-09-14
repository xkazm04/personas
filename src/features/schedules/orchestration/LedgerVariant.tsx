// LedgerVariant — the ENGINEERING TABLE.
//
// Metaphor: a ledger. Every input the admission ladder reads is a column —
// rank, persona, charters, interval floor, last served, wake — and the next
// tick's verdict is the last column, so the operator can see WHY a persona
// waits (its floor, its cap, its budget) in the same row as the fact that it
// does. Numerals are tabular; the drag handle is the first cell. Three big
// counters above the table say what the tick would do in aggregate.
//
// Differs from the Runway by showing causes before outcomes, and from the
// Slots board by refusing any spatial metaphor: it is the truth table of
// `admit_persona`, and nothing else.

import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';
import type { DispatchOrderState } from './useDispatchOrder';
import { LaneChip, PersonaIdentity, RankMark, ReorderButtons, VerdictChip } from './parts';

const TH = 'px-3 py-2 text-left typo-label text-foreground';
const TD = 'px-3 py-2 align-middle typo-caption text-foreground';

function Counter({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex flex-col rounded-card border border-border bg-secondary/10 px-4 py-3">
      <span className={`typo-data-lg tabular-nums ${tone}`}>{value}</span>
      <span className="typo-label text-foreground">{label}</span>
    </div>
  );
}

function LedgerRow({ row, index, count, onMove }: { row: DispatchPreviewRow; index: number; count: number; onMove: DispatchOrderState['move'] }) {
  const { t, tx } = useTranslation();
  const s = t.schedules;
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="tr"
      value={row.personaId}
      dragListener={false}
      dragControls={controls}
      className="group border-t border-border/60 bg-background hover:bg-secondary/20"
      data-testid={`ledger-row-${row.personaId}`}
    >
      <td className={`${TD} w-8`}>
        <DragHandle reveal="always" onPointerDown={(e) => controls.start(e)} label={s.orch_reorder_aria} className="cursor-grab touch-none" />
      </td>
      <td className={`${TD} w-20`}>
        <RankMark rank={row.rank} position={row.position} />
      </td>
      <td className={`${TD} min-w-[12rem]`}>
        <PersonaIdentity row={row} dense />
      </td>
      <td className={`${TD} tabular-nums`}>{row.charters}</td>
      <td className={`${TD} tabular-nums`}>
        {tx(s.orch_interval, { minutes: row.intervalMinutes })}
        {row.selfPaced && <span className="ml-1 opacity-60">{s.orch_self_paced}</span>}
      </td>
      <td className={TD}>{row.lastServedAt ? <RelativeTime timestamp={row.lastServedAt} /> : s.orch_never_served}</td>
      <td className={TD}>{row.wakePending ? s.orch_wake_pending : '—'}</td>
      <td className={TD}>
        <LaneChip lane={row.lane} />
      </td>
      <td className={TD}>
        <VerdictChip row={row} />
      </td>
      <td className={`${TD} w-8`}>
        <ReorderButtons id={row.personaId} first={index === 0} last={index === count - 1} onMove={onMove} />
      </td>
    </Reorder.Item>
  );
}

export function LedgerVariant({ state, view }: { state: DispatchOrderState; view: DispatchPreviewView }) {
  const { t } = useTranslation();
  const s = t.schedules;
  const { rows, reorder, move, saving } = state;
  const ids = rows.map((r) => r.personaId);
  const held = rows.filter((r) => r.verdict.kind === 'refused').length;

  return (
    <div className="space-y-3" aria-busy={saving} data-testid="orchestration-ledger">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter value={view.preview.budget} label={s.orch_budget_starts} tone="text-foreground" />
        <Counter value={view.preview.wouldStart} label={s.orch_would_start} tone="text-status-success" />
        <Counter value={view.preview.waiting} label={s.orch_waiting} tone="text-status-warning" />
        <Counter value={held} label={s.orch_band_held} tone="text-status-error" />
      </div>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse">
          <thead className="bg-secondary/20">
            <tr>
              <th className={TH} />
              <th className={TH}>{s.orch_col_rank}</th>
              <th className={TH}>{s.orch_col_persona}</th>
              <th className={TH}>{s.orch_col_charters}</th>
              <th className={TH}>{s.orch_col_interval}</th>
              <th className={TH}>{s.orch_col_last_served}</th>
              <th className={TH}>{s.orch_col_wake}</th>
              <th className={TH}>{s.orch_col_lane}</th>
              <th className={TH}>{s.orch_col_next_tick}</th>
              <th className={TH} />
            </tr>
          </thead>
          <Reorder.Group as="tbody" axis="y" values={ids} onReorder={reorder} aria-label={s.orch_reorder_aria}>
            {rows.map((row, i) => (
              <LedgerRow key={row.personaId} row={row} index={i} count={rows.length} onMove={move} />
            ))}
          </Reorder.Group>
        </table>
      </div>
    </div>
  );
}

export default LedgerVariant;
