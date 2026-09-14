// SlotsVariant — the BOARD OF SLOTS.
//
// Metaphor: a control room. The tick's budget is drawn as that many SLOT
// tiles across the top — each one a physical start the machine can afford
// this tick (pacing × headroom) — and the persona that would take it sits in
// the tile with the lane it would run. Below, the QUEUE: every other persona
// as a compact card in the operator's order, dragged left and right; the
// first cards are the ones that fill a slot when one opens. A held persona's
// card is dimmed with its rung named, so the queue reads as "next up" and
// "not eligible now" without leaving the row.
//
// Differs from the Runway and the Ledger by making the CAPACITY the primary
// object: the operator sees three empty tiles and understands the pacing
// before reading a single persona.

import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';
import type { DispatchOrderState } from './useDispatchOrder';
import { LaneChip, PersonaIdentity, RankMark, ReorderButtons, VerdictChip, laneLabel, refusalLabel } from './parts';

function SlotTile({ index, row }: { index: number; row: DispatchPreviewRow | null }) {
  const { t, tx } = useTranslation();
  const s = t.schedules;
  return (
    <div
      className={`flex min-h-[7rem] flex-col justify-between rounded-card border p-3 ${
        row ? 'border-status-success/40 bg-status-success/10 shadow-elevation-1' : 'border-dashed border-border bg-secondary/5'
      }`}
      data-testid={`slot-tile-${index + 1}`}
      data-filled={Boolean(row)}
    >
      <div className="flex items-center justify-between">
        <span className="typo-label text-foreground">{tx(s.orch_slot_n, { n: index + 1 })}</span>
        {row?.lane && <span className="typo-label text-status-success">{laneLabel(s, row.lane)}</span>}
      </div>
      {row ? (
        <div className="flex items-center gap-2">
          <PersonaIcon icon={row.personaIcon} color={row.personaColor} name={row.personaName} display="pop" frameSize="lg" />
          <div className="min-w-0">
            <div className="truncate typo-title text-foreground">{row.personaName}</div>
            <div className="typo-caption text-foreground">
              <RankMark rank={row.rank} position={row.position} />
            </div>
          </div>
        </div>
      ) : (
        <span className="typo-caption text-foreground opacity-60">{s.orch_slot_open}</span>
      )}
    </div>
  );
}

function QueueCard({ row, index, count, onMove }: { row: DispatchPreviewRow; index: number; count: number; onMove: DispatchOrderState['move'] }) {
  const { t } = useTranslation();
  const s = t.schedules;
  const controls = useDragControls();
  const refused = row.verdict.kind === 'refused' ? row.verdict : null;
  const held = refused !== null;
  const starting = row.verdict.kind === 'dispatch';
  const card = (
    <Reorder.Item
      value={row.personaId}
      dragListener={false}
      dragControls={controls}
      className={`group flex w-56 flex-shrink-0 flex-col gap-2 rounded-card border p-2 ${
        starting ? 'border-status-success/40 bg-status-success/5' : held ? 'border-border bg-secondary/5 opacity-70' : 'border-border bg-secondary/10'
      }`}
      data-testid={`queue-card-${row.personaId}`}
    >
      <div className="flex items-center gap-1">
        <DragHandle reveal="always" onPointerDown={(e) => controls.start(e)} label={s.orch_reorder_aria} className="cursor-grab touch-none" />
        <RankMark rank={row.rank} position={row.position} />
        <span className="ml-auto">
          <ReorderButtons id={row.personaId} first={index === 0} last={index === count - 1} onMove={onMove} />
        </span>
      </div>
      <PersonaIdentity row={row} dense />
      <div className="flex flex-wrap items-center gap-1">
        <LaneChip lane={row.lane} />
        <VerdictChip row={row} />
      </div>
    </Reorder.Item>
  );
  return refused ? <Tooltip content={`${refusalLabel(s, refused.refusal)} — ${refused.reason}`}>{card}</Tooltip> : card;
}

export function SlotsVariant({ state, view }: { state: DispatchOrderState; view: DispatchPreviewView }) {
  const { t, tx } = useTranslation();
  const s = t.schedules;
  const { rows, reorder, move, saving } = state;
  const ids = rows.map((r) => r.personaId);
  const budget = view.preview.budget;
  const starters = rows.filter((r) => r.verdict.kind === 'dispatch');
  const tiles = Array.from({ length: Math.max(budget, starters.length) }, (_, i) => starters[i] ?? null);

  return (
    <div className="space-y-4" aria-busy={saving} data-testid="orchestration-slots">
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <span className="typo-heading text-foreground">{s.orch_slots_title}</span>
          <span className="typo-caption text-foreground">{tx(s.orch_slots_hint, { budget })}</span>
        </div>
        {tiles.length === 0 ? (
          <div className="rounded-card border border-dashed border-border p-4 typo-caption text-foreground">{s.orch_slots_none}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {tiles.map((row, i) => (
              <SlotTile key={row?.personaId ?? `open-${i}`} index={i} row={row} />
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <span className="typo-heading text-foreground">{s.orch_queue_title}</span>
          <span className="typo-caption text-foreground">{s.orch_queue_hint}</span>
        </div>
        <Reorder.Group axis="x" values={ids} onReorder={reorder} className="flex gap-3 overflow-x-auto pb-2" aria-label={s.orch_reorder_aria}>
          {rows.map((row, i) => (
            <QueueCard key={row.personaId} row={row} index={i} count={rows.length} onMove={move} />
          ))}
        </Reorder.Group>
      </section>
    </div>
  );
}

export default SlotsVariant;
