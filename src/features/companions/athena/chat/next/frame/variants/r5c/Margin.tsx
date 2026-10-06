/**
 * Folio · the margin, at rest. A ruled line down the right edge with the notes
 * a reader keeps there:
 * - what waits on YOU, as footnote marks (* † ‡ § ‖ ¶) in their kind's ink,
 *   under a count; the rule itself takes the waiting ink. Shape and count say
 *   "something waits" without colour, the first mark breathes.
 * - what RUNS, as spine labels: each project in small caps, set vertically,
 *   with one shape per run (disc working, diamond needs you, cross stuck,
 *   dashed ring queued, ring idle).
 * Marks open the folio on their page (Alt+W opens it on the first); the spines
 * unfold into margin notes (Alt+M). When the folio opens, each mark flies into
 * its contents line: the margin and the folio are one object.
 */

import { AnimatePresence, motion } from 'framer-motion';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { NEXT_COPY as N } from '../../../nextCopy';
import { ATHENA_COLUMN, type ProjectColumn } from '../../../useProcessColumns';
import type { WorkItem } from '../../../useWorkforce';
import { FOLIO_COPY as C } from './copy';
import { FLIGHT, STILL, footnoteMark, itemTitle, kindInk, RUN_RANK, runState } from './marks';
import { StateMark } from './parts';

const SHOWN_MARKS = 8;
/** Above this many marks the margin sets them two to a line, so it stays short. */
const ONE_COLUMN = 4;
const SHOWN_RUNS = 6;

export function columnName(c: ProjectColumn): string {
  return c.key === ATHENA_COLUMN ? C.herOwn : c.label;
}

export function Margin({
  hidden,
  items,
  columns,
  notesOpen,
  onOpenItem,
  onToggleNotes,
}: {
  hidden: boolean;
  items: WorkItem[];
  columns: ProjectColumn[];
  notesOpen: boolean;
  onOpenItem: (id: string | null) => void;
  onToggleNotes: () => void;
}) {
  const { shouldAnimate } = useMotion();
  const { t } = useTranslation();
  const shown = items.slice(0, SHOWN_MARKS);
  const over = items.length - shown.length;
  const spines = columns.filter((c) => c.processes.length > 0);

  return (
    <div className="r5c-margin-seat">
      <AnimatePresence>
        {!hidden && (
          <motion.nav
            className="r5c-margin"
            aria-label={C.marginNamed}
            data-testid="companion-r5c-margin"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.25 : 0 }}
          >
            <span className={`r5c-rule${items.length ? ' waits' : ''}`} aria-hidden />
            <Tooltip placement="left" content={`${C.waitingCount(items.length)} · ${C.keyFolio}`}>
              <Button
                variant="ghost"
                size="sm"
                className="r5c-count"
                onClick={() => onOpenItem(null)}
                aria-keyshortcuts="Alt+W"
                aria-label={`${items.length ? C.waitingCount(items.length) : C.noneWaiting}. ${C.folioNamed}`}
                data-testid="companion-r5c-count"
              >
                {items.length ? (
                  <span className="typo-data-lg r5c-count-n">{items.length}</span>
                ) : (
                  <span className="r5c-sc typo-label r5c-vertical">{C.noneWaiting}</span>
                )}
              </Button>
            </Tooltip>
            {shown.length > 0 && (
              <ol className={`r5c-fns${shown.length > ONE_COLUMN ? ' two' : ''}`}>
                {shown.map((it, i) => (
                  <li key={it.id}>
                    <Tooltip placement="left" content={`${N.kind[it.kind]} · ${itemTitle(t, it)}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`r5c-fn${i === 0 && shouldAnimate ? ' r5c-breathe r5c-loop' : ''}`}
                        style={{ ['--ink' as string]: kindInk(it.kind) }}
                        onClick={() => onOpenItem(it.id)}
                        aria-label={`${N.kind[it.kind]}: ${itemTitle(t, it)}`}
                        data-testid="companion-r5c-footnote"
                      >
                        <motion.span
                          layoutId={`r5c-fn-${it.id}`}
                          transition={shouldAnimate ? FLIGHT : STILL}
                          className={`${shown.length > ONE_COLUMN ? 'typo-title-lg' : 'typo-heading-lg'} r5c-fn-glyph`}
                        >
                          {footnoteMark(i)}
                        </motion.span>
                      </Button>
                    </Tooltip>
                  </li>
                ))}
              </ol>
            )}
            {over > 0 && <span className="typo-label r5c-over">+{over}</span>}
            {spines.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="r5c-spines"
                onClick={onToggleNotes}
                aria-expanded={notesOpen}
                aria-keyshortcuts="Alt+M"
                aria-label={`${notesOpen ? C.foldNotes : C.openNotes}. ${spines
                  .map((c) => C.runsIn(columnName(c), c.processes.length))
                  .join(', ')}`}
                data-testid="companion-r5c-threads"
              >
                {spines.map((c) => {
                  const runs = [...c.processes].sort((a, b) => RUN_RANK[runState(a)] - RUN_RANK[runState(b)]);
                  return (
                    <span key={c.key} className="r5c-spine">
                      <span className="r5c-sc typo-label r5c-vertical r5c-spine-name">{columnName(c)}</span>
                      <span className="r5c-spine-runs">
                        {runs.slice(0, SHOWN_RUNS).map((p) => (
                          <StateMark key={p.id} state={runState(p)} />
                        ))}
                      </span>
                    </span>
                  );
                })}
              </Button>
            )}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}
