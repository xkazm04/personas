// Departures · DeparturesRunway — the literal departures board. PROTOTYPE (C).
//
//   NOW BOARDING  7 / 10
//   GATE  SESSION ……………… PROJECT   ORIGIN      ELAPSED
//   01    gate_runs.db stat…  ascent    ✦ Athena      12m
//   08    — open —
//   11    Late admit          kp        ✋ Manual       2m   OVERBOOKED
//
//   SCHEDULED  4
//   #01   Title ……………… project   ✦ Athena   ETA 14:32   ↑ ↓ Start now · Cancel
//
// A gate is a slot under the cap: one row per slot, open slots printed as
// open rather than left out, so the cap is something you can SEE.

import { useTranslation } from '@/i18n/useTranslation';
import type { ActivitySurface } from '../useActivitySurface';
import type { useQueueConfirm } from '../shared';
import { SessionLine } from './SessionLine';
import { ScheduledLine } from './ScheduledLine';
import { pad2, RuledHeader } from './parts';

const GATE = (n: number) => (
  <span className="w-10 flex-shrink-0 typo-data tabular-nums text-foreground opacity-60">{pad2(n)}</span>
);

export function DeparturesRunway({
  surface, now, confirm,
}: {
  surface: ActivitySurface;
  now: number;
  confirm: ReturnType<typeof useQueueConfirm>;
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { queueModel: model, queueOrder: order, focusKey, setTerminal, setRecap } = surface;
  const cap = Math.max(0, model.cap);
  const inBand = model.running.slice(0, cap);
  const over = model.running.slice(cap);
  const free = Math.max(0, cap - inBand.length);
  const queued = order.items;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="fleet-queue-runway">
      <RuledHeader
        label="Now boarding"
        trailing={<span className="typo-data tabular-nums text-foreground opacity-70">{model.running.length} / {cap}</span>}
      />
      <div className="flex items-baseline gap-2.5 border-b border-border/40 px-2 pb-1 pt-1.5 typo-label text-foreground opacity-45" aria-hidden>
        <span className="w-10 flex-shrink-0">Gate</span>
        <span className="w-1.5 flex-shrink-0" />
        <span className="min-w-0 flex-1">{s.queue_band_running}</span>
        <span className="hidden w-36 flex-shrink-0 xl:block">Project</span>
        <span className="w-28 flex-shrink-0">Origin</span>
        <span className="w-14 flex-shrink-0 text-right">Elapsed</span>
        <span className="w-5 flex-shrink-0" />
      </div>
      <div className="flex flex-col" data-testid="fleet-queue-running-band">
        {inBand.map((item, i) => (
          <SessionLine
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            lead={GATE(i + 1)}
            flash={focusKey === `s:${item.sessionId}`}
            onOpen={setTerminal}
            onRecap={setRecap}
            testId="fleet-queue-tile"
          />
        ))}
        {Array.from({ length: free }, (_, i) => (
          <div key={`free-${i}`} className="flex items-center gap-2.5 border-b border-border/20 px-2 py-1" data-testid="fleet-queue-free-slot">
            {GATE(inBand.length + i + 1)}
            <span className="typo-caption text-foreground opacity-35">— {s.queue_slot_free.toLowerCase()} —</span>
          </div>
        ))}
        {over.map((item, i) => (
          <SessionLine
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            lead={GATE(cap + i + 1)}
            flag={s.queue_over_admitted}
            flash={focusKey === `s:${item.sessionId}`}
            onOpen={setTerminal}
            onRecap={setRecap}
            testId="fleet-queue-tile"
          />
        ))}
      </div>

      <RuledHeader label="Scheduled" count={queued.length} className="mt-6" />
      {queued.length > 0 ? (
        <div role="list" aria-label={s.queue_reorder_aria} className="flex flex-col" data-testid="fleet-queue-strip">
          {queued.map((item, i) => (
            <ScheduledLine
              key={item.sessionId}
              item={item}
              position={i + 1}
              first={i === 0}
              last={i === queued.length - 1}
              flash={focusKey === `s:${item.sessionId}`}
              onNudge={order.nudge}
              onStart={confirm.askStart}
              onCancel={confirm.askCancel}
            />
          ))}
        </div>
      ) : (
        <p className="px-2 py-2 typo-caption text-foreground opacity-50">{s.queue_strip_empty}</p>
      )}
    </div>
  );
}
