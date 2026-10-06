/**
 * Folio · margin notes: the margin's spine labels unfolded into what a reader
 * writes beside the text. RUNNING comes first: per project (small caps) its
 * runs, worst first, each with its state shape and word, Athena's own work at
 * the head. Then the other threads with unread words, then the footnotes (what
 * waits on you), each opening its folio page. A run opens where it lives (its
 * terminal, the Run Desk). Alt+M or Esc folds the notes back into the margin.
 */

import { AnimatePresence, motion } from 'framer-motion';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { NEXT_COPY as N } from '../../../nextCopy';
import type { ProcessMark, ProjectColumn } from '../../../useProcessColumns';
import { switchThread, type WorkItem, type Workforce } from '../../../useWorkforce';
import { FOLIO_COPY as C } from './copy';
import { columnName } from './Margin';
import { FOLIO_EASE, footnoteMark, itemTitle, kindInk, RUN_RANK, runState } from './marks';
import { InkDrop, Key, StateMark } from './parts';

function Run({ p }: { p: ProcessMark }) {
  const state = runState(p);
  const body = (
    <>
      <StateMark state={state} size={11} />
      <span className="typo-body text-foreground r5c-note-run">{p.label}</span>
      <span className="typo-caption italic r5c-note-state">{C.state[state]}</span>
    </>
  );
  if (!p.open) return <li className="r5c-note-row">{body}</li>;
  return (
    <li>
      <Button variant="ghost" size="sm" className="r5c-note-row" onClick={p.open}>
        {body}
      </Button>
    </li>
  );
}

export function MarginNotes({
  open,
  items,
  columns,
  threads,
  onOpenItem,
  onClose,
}: {
  open: boolean;
  items: WorkItem[];
  columns: ProjectColumn[];
  threads: Workforce['threads'];
  onOpenItem: (id: string) => void;
  onClose: () => void;
}) {
  const { shouldAnimate } = useMotion();
  const { t } = useTranslation();
  const spines = columns.filter((c) => c.processes.length > 0);
  return (
    <div className="r5c-notes-seat">
      <AnimatePresence>
        {open && (
          <motion.aside
            className="r5c-notes"
            aria-label={C.notesTitle}
            data-testid="companion-r5c-notes"
            initial={shouldAnimate ? { clipPath: 'inset(0 0 0 100%)' } : { opacity: 0 }}
            animate={shouldAnimate ? { clipPath: 'inset(0 0 0 0%)' } : { opacity: 1 }}
            exit={shouldAnimate ? { clipPath: 'inset(0 0 0 100%)' } : { opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.32 : 0, ease: FOLIO_EASE }}
          >
            <header className="r5c-notes-head">
              <span className="r5c-sc typo-label">{C.notesTitle}</span>
              <Button variant="ghost" size="xs" onClick={onClose} aria-keyshortcuts="Escape">
                {C.close} <Key>{C.keyFold}</Key>
              </Button>
            </header>
            <section>
              <h3 className="typo-eyebrow r5c-notes-h">{C.running}</h3>
              {spines.length === 0 && <p className="typo-caption italic">{C.nothingRuns}</p>}
              {spines.map((c) => (
                <div key={c.key} className="r5c-note-project">
                  <p className="r5c-sc typo-label r5c-note-projname">{columnName(c)}</p>
                  <ul className="r5c-note-list">
                    {[...c.processes]
                      .sort((a, b) => RUN_RANK[runState(a)] - RUN_RANK[runState(b)])
                      .map((p) => (
                        <Run key={p.id} p={p} />
                      ))}
                  </ul>
                </div>
              ))}
            </section>
            {threads.length > 0 && (
              <section>
                <h3 className="typo-eyebrow r5c-notes-h">{C.otherThreads}</h3>
                <ul className="r5c-note-list">
                  {threads.map((th) => (
                    <li key={th.id}>
                      <Button variant="ghost" size="sm" className="r5c-note-row" onClick={() => switchThread(th.id)}>
                        <InkDrop />
                        <span className="typo-body text-foreground r5c-note-run">{th.title}</span>
                        <span className="typo-caption italic r5c-note-state">{C.unreadIn(th.unread)}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {items.length > 0 && (
              <section>
                <h3 className="typo-eyebrow r5c-notes-h">{C.waitsOnYou}</h3>
                <ol className="r5c-note-list">
                  {items.map((it, i) => (
                    <li key={it.id}>
                      <Button variant="ghost" size="sm" className="r5c-note-row r5c-note-fn" onClick={() => onOpenItem(it.id)}>
                        <span className="typo-heading r5c-note-mark" style={{ color: kindInk(it.kind) }} aria-hidden>
                          {footnoteMark(i)}
                        </span>
                        <span className="min-w-0">
                          <span className="r5c-sc typo-label r5c-note-kind">{N.kind[it.kind]}</span>
                          <span className="typo-body text-foreground r5c-note-title">{itemTitle(t, it)}</span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
