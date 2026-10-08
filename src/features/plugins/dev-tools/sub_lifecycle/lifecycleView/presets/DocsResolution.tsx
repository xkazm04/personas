// "How it is resolved": every doc the scan judged, grouped by status worst
// first, one bullet each - its path and one line of why (the broken
// references, or the changed sources it has not caught up with). The clean
// group is the long, quiet one, so it starts folded.
import { useState } from 'react';
import { FileCheck, FileQuestion, FileWarning, FileX, type LucideIcon } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';

import { useLifecycleViewModel } from '../context';
import { RHYTHM } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { Count } from '../system/Count';
import type { DocGroup, DocStatus } from './docsModel';

const LOOK: Record<DocStatus, { glyph: LucideIcon; ink: string }> = {
  broken: { glyph: FileX, ink: 'text-status-error' },
  stale: { glyph: FileWarning, ink: 'text-status-warning' },
  unverifiable: { glyph: FileQuestion, ink: 'text-status-info' },
  clean: { glyph: FileCheck, ink: 'text-status-success' },
};

export function useDocStatusLabel() {
  const { dl } = useLifecycleViewModel();
  return (s: DocStatus): string => ({
    broken: dl.lc2_doc_broken, stale: dl.lc2_doc_stale, unverifiable: dl.lc2_doc_unverifiable, clean: dl.lc2_doc_clean,
  })[s];
}

function useWhy() {
  const { dl, tx } = useLifecycleViewModel();
  return (status: DocStatus, row: LifecycleDocRow): string => {
    const list = (xs: string[]) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? tx(dl.lc2_and_more, { count: xs.length - 3 }) : '');
    if (status === 'broken') return tx(dl.lc2_doc_why_broken, { count: row.brokenRefs.length, refs: list(row.brokenRefs) });
    if (status === 'stale') return tx(dl.lc2_doc_why_stale, { count: row.changedSources.length, sources: list(row.changedSources) });
    if (status === 'unverifiable') return dl.lc2_doc_why_unverifiable;
    return dl.lc2_doc_why_clean;
  };
}

function Group({ group }: { group: DocGroup }) {
  const { dl, tx } = useLifecycleViewModel();
  const label = useDocStatusLabel();
  const why = useWhy();
  const [open, setOpen] = useState(group.status !== 'clean');
  const { glyph: Glyph, ink } = LOOK[group.status];
  return (
    <div className={RHYTHM.tight} data-testid={`lc2-docs-${group.status}`}>
      <div className="flex items-center gap-2">
        <Glyph className={`${GLYPH.md} ${ink}`} aria-hidden />
        <span className={`${LT.title} ${ink}`}>{label(group.status)}</span>
        <Count value={group.docs.length} />
        {group.status === 'clean' && (
          <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? dl.lc2_docs_hide_clean : tx(dl.lc2_docs_show_clean, { count: group.docs.length })}
          </Button>
        )}
      </div>
      <Collapse open={open} unmountWhenClosed>
        <ul className={`list-disc pl-9 marker:text-foreground ${RHYTHM.tight}`}>
          {group.docs.map((d) => (
            <li key={d.docPath} className="pl-1">
              <span className={`break-all ${LT.code}`}>{d.docPath}</span>
              <span className={`block ${LT.row}`}>{why(group.status, d)}</span>
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}

export function DocsResolution({ groups }: { groups: DocGroup[] }) {
  return (
    <div className={RHYTHM.block} data-testid="lc2-docs-resolution">
      {groups.map((g) => <Group key={g.status} group={g} />)}
    </div>
  );
}
