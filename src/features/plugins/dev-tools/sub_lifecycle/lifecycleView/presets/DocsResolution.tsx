// "How it is resolved": every doc the filter keeps, grouped by status worst
// first, one row each (`docs/DocRow`). The clean group is the long, quiet
// one, so it starts folded unless the filter asks for it. Up / Down move
// between the rows' presses (from inside an opened doc, Up returns to its
// row); Enter opens a doc. A doc picked on the estate map is opened here and
// brought into view.
import { useEffect, useRef, type KeyboardEvent } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Rows } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { useLifecycleViewModel } from '../context';
import { Count } from '../system/Count';
import { RHYTHM } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { DOC_HEAD } from './docs/docLooks';
import { DocRow } from './docs/DocRow';
import { useDocStatusLabel } from './docs/docWords';
import type { DocsView } from './docs/useDocsView';
import type { DocGroup } from './docsModel';

const PRESS = '[data-doc-row] .k-row__press';

function Group({ group, view }: { group: DocGroup; view: DocsView }) {
  const { dl, tx } = useLifecycleViewModel();
  const label = useDocStatusLabel();
  const clean = group.status === 'clean';
  const open = !clean || view.cleanShown;
  const forced = view.filter.statuses.has('clean') || view.filter.query.trim() !== '';
  const { glyph: Glyph, ink } = DOC_HEAD[group.status];
  return (
    <div className={RHYTHM.tight} data-testid={`lc2-docs-${group.status}`}>
      <div className="flex items-center gap-2">
        <Glyph className={`${GLYPH.md} ${ink}`} aria-hidden />
        <span className={`${LT.title} ${ink}`}>{label(group.status)}</span>
        <Count value={group.docs.length} />
        {clean && !forced && (
          <Button variant="ghost" size="xs" onClick={view.toggleClean} aria-expanded={open} data-testid="lcx7-clean-toggle">
            {open ? dl.lc2_docs_hide_clean : tx(dl.lc2_docs_show_clean, { count: group.docs.length })}
          </Button>
        )}
      </div>
      <Collapse open={open} unmountWhenClosed>
        <Rows count={group.docs.length} empty={{ title: '' }}>
          {group.docs.map((d) => (
            <DocRow
              key={d.docPath}
              row={d}
              status={group.status}
              items={view.backlog.byDoc.get(d.docPath) ?? []}
              expanded={view.expanded.has(d.docPath)}
              selected={view.selected === d.docPath}
              onToggle={() => view.toggleRow(d.docPath)}
            />
          ))}
        </Rows>
      </Collapse>
    </div>
  );
}

export function DocsResolution({ view }: { view: DocsView }) {
  const { dl } = useLifecycleViewModel();
  const listRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { focus } = view;

  // A doc picked on the map: once its row is rendered (its group may just have opened), scroll to it and focus it.
  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => {
      const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-doc-row]') ?? [])].find((el) => el.dataset.docPath === focus.path);
      row?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      row?.querySelector<HTMLElement>('.k-row__press')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [focus, reduced]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [role="listbox"]')) return;
    const presses = [...(listRef.current?.querySelectorAll<HTMLElement>(PRESS) ?? [])];
    const row = target.closest('[data-doc-row]');
    const own = row?.querySelector<HTMLElement>('.k-row__press') ?? null;
    const at = own ? presses.indexOf(own) : -1;
    const onPress = target === own;
    const to = e.key === 'ArrowDown' ? (at < 0 ? 0 : at + 1) : onPress ? at - 1 : at;
    const next = presses[Math.min(Math.max(0, to), presses.length - 1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView?.({ block: 'nearest' });
  };

  if (view.groups.length === 0) {
    return <Rows count={0} empty={{ title: dl.lcx7_no_match, hint: dl.lcx7_no_match_hint }}>{null}</Rows>;
  }
  return (
    <div ref={listRef} className={RHYTHM.block} onKeyDown={onKeyDown} data-testid="lc2-docs-resolution">
      {view.groups.map((g) => <Group key={g.status} group={g} view={view} />)}
    </div>
  );
}
