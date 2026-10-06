/**
 * The docked queue — the peek, moved to the desk's left edge (shared layoutIds).
 * Full rows on the working desk; in the reading room it narrows to a lamp column.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { chipOf, type DecisionItem } from '../../../model/decisionModel';
import { CHIP_META, DUR, TIER_TONE, TONE_FILL, costOf, tierOf } from './model';

interface Props {
  queue: DecisionItem[];
  active: number;
  decided: number;
  scopeLabel: string;
  slim: boolean;
  reduced: boolean;
  onJump: (i: number) => void;
}

export function DeskRail({ queue, active, decided, scopeLabel, slim, reduced, onJump }: Props) {
  const total = queue.length + decided;
  const pct = total === 0 ? 100 : Math.round((decided / total) * 100);
  return (
    <motion.aside layout={!reduced} className="p3-rail" aria-label="Queue" data-testid="p3-rail">
      {!slim && (
        <div className="flex flex-col gap-2 border-b border-border px-4 pb-3 pt-4">
          <span className="typo-label text-foreground">{scopeLabel}</span>
          <div className="flex items-baseline justify-between">
            <span className="typo-heading text-foreground">{queue.length} left</span>
            <span className="typo-caption">{decided} decided</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
            <motion.div className="h-full bg-status-success" initial={false} animate={{ width: `${pct}%` }}
              transition={{ duration: reduced ? 0 : DUR.normal }} />
          </div>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto ${slim ? 'items-center px-1 py-3' : 'p-2'}`}>
        <AnimatePresence initial={false}>
          {queue.map((item, i) => {
            const Icon = CHIP_META[chipOf(item.kind)].icon;
            const tone = TIER_TONE[tierOf(item)];
            const on = i === active;
            if (slim) {
              return (
                <Tooltip key={item.id} content={item.title} placement="right">
                  <Button variant="ghost" size="icon-md" onClick={() => onJump(i)} aria-current={on}
                    aria-label={item.title} className={on ? 'bg-primary/15 ring-1 ring-primary/40' : ''}>
                    <span className="relative">
                      <Icon className={`h-4 w-4 ${on ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
                      <span className={`absolute -right-1.5 -top-1 h-2 w-2 rounded-full ${TONE_FILL[tone]}`} aria-hidden />
                    </span>
                  </Button>
                </Tooltip>
              );
            }
            return (
              <motion.div
                key={item.id}
                layoutId={reduced ? undefined : `p3-q-${item.id}`}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, x: -24 }}
                transition={{ duration: DUR.normal }}
                className={`p3-row ${on ? 'is-focus' : ''}`}
                onClick={() => onJump(i)}
                aria-current={on}
              >
                <span className={`p3-row__tier ${TONE_FILL[tone]}`} aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={`typo-body truncate ${on ? 'text-foreground' : 'text-muted-foreground'}`}>{item.title}</span>
                  <span className="flex items-center gap-1.5 typo-caption">
                    <Icon className="h-3 w-3 flex-shrink-0" aria-hidden />
                    <span className="truncate">{costOf(item)}</span>
                  </span>
                </span>
                <span className="typo-caption pr-1">{i + 1}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
