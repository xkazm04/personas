// One doc in the resolution list: its path (the folder quiet, the file
// strong), its status as the module's pill, a mark when the backlog already
// has an item about it, its one line of why, and an expander that opens the
// doc's detail (`DocDetail`) under the row with motion. Pressing the path
// does the same, so the row's one tab stop opens it (Enter); the list moves
// between rows with Up / Down (`DocsResolution`).
import { useEffect, useId, useRef } from 'react';
import { ChevronDown, ClipboardList } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { ListRow } from '@/features/shared/components/kit';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { Pill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import { splitDocPath, type DocStatus } from '../docsModel';
import { DOC_MARK } from './docLooks';
import { DocDetail } from './DocDetail';
import { DocPill, useDocStatusLabel, useDocWhy } from './docWords';

const FILED_LOOK = { tone: 'info', stroke: 'hairline', glyph: ClipboardList } as const;

export function PathName({ path }: { path: string }) {
  const { dir, name } = splitDocPath(path);
  return (
    <span className="flex min-w-0 items-baseline">
      {dir && <span className={`min-w-0 shrink truncate ${LT.meta}`}>{dir}</span>}
      <span className={`shrink-0 ${LT.title}`}>{name}</span>
    </span>
  );
}

interface DocRowProps {
  row: LifecycleDocRow;
  status: DocStatus;
  items: LifecycleRelatedItem[];
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
}

export function DocRow({ row, status, items, expanded, selected, onToggle }: DocRowProps) {
  const { dl } = useLifecycleViewModel();
  const label = useDocStatusLabel();
  const why = useDocWhy();
  const detailId = useId();
  const path = row.docPath;
  const rowRef = useRef<HTMLDivElement>(null);
  // The kit row's press is the row's one tab stop; it is this row's disclosure, so it says so.
  useEffect(() => {
    const press = rowRef.current?.querySelector('.k-row__press');
    press?.setAttribute('aria-expanded', String(expanded));
    press?.setAttribute('aria-controls', detailId);
  }, [expanded, detailId]);
  return (
    <div ref={rowRef} data-doc-row data-doc-path={path} data-expanded={expanded || undefined}>
      <ListRow
        name={<PathName path={path} />}
        meta={<span className="min-w-0 truncate">{why(row)}</span>}
        mark={{ ...DOC_MARK[status], label: label(status) }}
        figures={(
          <>
            {items.length > 0 && <Pill look={FILED_LOOK} label={dl.lcx7_filed_short} testId={`lcx7-filed-mark-${path}`} />}
            <DocPill status={status} />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={detailId}
              aria-label={expanded ? dl.lcx7_collapse : dl.lcx7_expand}
              tabIndex={-1}
              data-testid={`lcx7-expand-${path}`}
            >
              <ChevronDown className={`${GLYPH.sm} transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
            </Button>
          </>
        )}
        state={selected ? 'selected' : undefined}
        onPress={onToggle}
        testId={`lc2-doc-row-${path}`}
      />
      <Collapse open={expanded} unmountWhenClosed>
        <DocDetail id={detailId} row={row} status={status} items={items} />
      </Collapse>
    </div>
  );
}
