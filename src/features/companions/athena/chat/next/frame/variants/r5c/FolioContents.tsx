/**
 * Folio · the verso. CONTENTS: every item waiting on you, by its footnote mark
 * (the very mark that sat in the margin flies here), its kind in small caps,
 * its name, a dot leader and its page number; set-aside pages stay listed but
 * quiet, and the list scrolls the current page into view. INDEX OF WORKS,
 * held at the foot of the verso so it never scrolls away: each project in
 * small caps, a shape per run, a leader to its count; its runs by name on hover
 * or focus, and in the margin notes (Alt+M).
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { NEXT_COPY as N } from '../../../nextCopy';
import type { ProjectColumn } from '../../../useProcessColumns';
import type { WorkItem } from '../../../useWorkforce';
import { FOLIO_COPY as C } from './copy';
import { columnName } from './Margin';
import { FLIGHT, STILL, footnoteMark, itemTitle, kindInk, RUN_RANK, runState } from './marks';
import { StateMark } from './parts';

function IndexEntry({ column }: { column: ProjectColumn }) {
  const runs = [...column.processes].sort((a, b) => RUN_RANK[runState(a)] - RUN_RANK[runState(b)]);
  const named = runs.map((p) => `${p.label} (${C.state[runState(p)]})`).join(', ');
  return (
    <Tooltip placement="right" content={named}>
      <div className="r5c-index-row">
        <span className="r5c-sc typo-label r5c-index-name">{columnName(column)}</span>
        <span className="r5c-index-shapes" aria-hidden>
          {runs.slice(0, 8).map((p) => (
            <StateMark key={p.id} state={runState(p)} size={11} />
          ))}
        </span>
        <span className="r5c-leader" aria-hidden />
        <span className="typo-data r5c-toc-page">{runs.length}</span>
        <span className="sr-only">{named}</span>
      </div>
    </Tooltip>
  );
}

export function FolioContents({
  items,
  live,
  activeId,
  columns,
  onPick,
}: {
  items: WorkItem[];
  live: WorkItem[];
  activeId: string | null;
  columns: ProjectColumn[];
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { shouldAnimate } = useMotion();
  const works = columns.filter((c) => c.processes.length > 0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <nav className="r5c-verso" aria-label={C.contents} data-testid="companion-r5c-contents">
      <div ref={listRef} className="r5c-verso-contents scrollbar-thin">
        <h2 className="r5c-sc typo-label r5c-verso-h">{C.contents}</h2>
        {items.length === 0 && <p className="typo-body italic r5c-verso-none">{C.nothingWaitsTitle}</p>}
        <ol className="r5c-toc">
          {items.map((it, i) => {
            const page = live.indexOf(it);
            const current = it.id === activeId;
            return (
              <li key={it.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`r5c-toc-row${current ? ' current' : ''}`}
                  onClick={() => page >= 0 && onPick(it.id)}
                  disabled={page < 0}
                  aria-current={current ? 'page' : undefined}
                >
                  <motion.span layoutId={`r5c-fn-${it.id}`} transition={shouldAnimate ? FLIGHT : STILL} className="typo-heading r5c-toc-mark" style={{ color: kindInk(it.kind) }} aria-hidden>
                    {footnoteMark(i)}
                  </motion.span>
                  <span className="r5c-toc-text">
                    <span className="r5c-sc typo-label" style={{ color: kindInk(it.kind) }}>
                      {N.kind[it.kind]}
                    </span>{' '}
                    <span className="typo-body text-foreground">{itemTitle(t, it)}</span>
                  </span>
                  <span className="r5c-leader" aria-hidden />
                  <span className="typo-data r5c-toc-page">{page >= 0 ? page + 1 : C.aside}</span>
                </Button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="r5c-verso-index">
        <h2 className="r5c-sc typo-label r5c-verso-h">{C.indexOfWorks}</h2>
        {works.length === 0 && <p className="typo-body italic r5c-verso-none">{C.nothingRuns}</p>}
        {works.map((c) => (
          <IndexEntry key={c.key} column={c} />
        ))}
      </div>
    </nav>
  );
}
