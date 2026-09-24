// Atelier runway — capacity made literal. A row of N rounded slot cards (N =
// the cap): a filled slot is the session holding it, an open slot is a soft
// dashed card; sessions admitted past the cap sit after the slots in the
// warning tone. Under it, "Up next" is the queue as a clean ranked list.

import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { ActivitySurface } from '../useActivitySurface';
import { SessionChip } from './SessionChip';
import { QueueRow } from './QueueRow';
import { SectionLabel } from './parts';

export function AtelierRunway({
  surface, now, askStart, askCancel,
}: {
  surface: ActivitySurface;
  now: number;
  askStart: Parameters<typeof QueueRow>[0]['onStart'];
  askCancel: Parameters<typeof QueueRow>[0]['onCancel'];
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { queueModel: model, queueOrder: order, reducedMotion, focusKey } = surface;
  const cap = Math.max(0, model.cap);
  const inBand = model.running.slice(0, cap);
  const over = model.running.slice(cap);
  const free = Math.max(0, cap - inBand.length);
  const spring = reducedMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 380, damping: 34 };

  const slot = (key: string, children: React.ReactNode, overCap = false) => (
    <motion.div key={key} layoutId={reducedMotion ? undefined : `queue:${key}`} transition={spring} className={`min-w-0 ${overCap ? 'rounded-input ring-1 ring-status-warning/50' : ''}`}>
      {children}
    </motion.div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4" data-testid="fleet-queue-runway">
      <section className="flex flex-col gap-3">
        <SectionLabel
          count={model.running.length}
          trailing={over.length > 0 ? <span className="rounded-pill bg-status-warning/12 px-2 typo-label text-status-warning">{s.queue_over_admitted}</span> : undefined}
        >
          Capacity · {model.running.length} of {cap} slots
        </SectionLabel>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]" data-testid="fleet-queue-running-band">
          <AnimatePresence initial={false}>
            {inBand.map((item) => slot(item.sessionId, (
              <div className="rounded-card bg-secondary/25 p-1 shadow-elevation-1">
                <SessionChip session={item.session} item={item} now={now} flash={focusKey === `s:${item.sessionId}`} showProject reducedMotion={reducedMotion} onOpen={surface.setTerminal} onRecap={surface.setRecap} />
              </div>
            )))}
            {Array.from({ length: free }, (_, i) => (
              <div
                key={`free-${i}`}
                role="img"
                aria-label={s.queue_slot_free}
                data-testid="fleet-queue-free-slot"
                className="flex h-[4.25rem] items-center justify-center rounded-card border border-dashed border-border typo-caption text-foreground opacity-45"
              >
                Open slot
              </div>
            ))}
            {over.map((item) => slot(item.sessionId, (
              <SessionChip session={item.session} item={item} now={now} flash={focusKey === `s:${item.sessionId}`} overAdmitted showProject reducedMotion={reducedMotion} onOpen={surface.setTerminal} onRecap={surface.setRecap} />
            ), true))}
          </AnimatePresence>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel count={order.items.length}>Up next</SectionLabel>
        {order.items.length > 0 ? (
          <div role="list" aria-label={s.queue_reorder_aria} className="flex flex-col gap-0.5 rounded-card bg-secondary/20 p-1.5 shadow-elevation-1" data-testid="fleet-queue-strip">
            {order.items.map((item, i) => (
              <motion.div key={item.sessionId} layout={!reducedMotion} layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`} transition={spring}>
                <QueueRow
                  item={item}
                  first={i === 0}
                  last={i === order.items.length - 1}
                  flash={focusKey === `s:${item.sessionId}`}
                  onNudge={order.nudge}
                  onStart={askStart}
                  onCancel={askCancel}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 typo-body text-foreground opacity-55">{s.queue_strip_empty}</p>
        )}
      </section>
    </div>
  );
}
