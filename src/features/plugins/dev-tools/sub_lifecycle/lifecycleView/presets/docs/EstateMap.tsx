/**
 * THE DOC ESTATE: every judged doc as one cell in its folder's card, the
 * folders worst first and each as wide as its doc count, so where the rot is
 * reads before a word is read (`docLooks` for the cell shapes).
 *
 * - ONE listbox, one tab stop; each folder is a group, each cell an option.
 *   Left / Right step a doc, Up / Down jump to the folder before or after (at
 *   the same place in it), Home / End; Enter or Space opens the cursor's doc in
 *   the list below. The keys it uses are marked handled, and Layer 2's own
 *   arrow walk ignores a listbox, so they never walk the screen.
 * - The PEEK (`DocPeek`) shows the doc under the pointer, or the cursor's doc
 *   while the listbox has keyboard focus.
 * - The filter never moves a cell: a doc outside it fades back in place.
 */
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';

import { useLifecycleViewModel } from '../../context';
import { lcSurface } from '../../system/lcSurface';
import { cellRem } from './docLooks';
import { DocPeek } from './DocPeek';
import { EstateTile } from './EstateTile';
import type { DocsView } from './useDocsView';
import './docsEstate.css';

/** Whether focus arrived by keyboard (`:focus-visible`); a DOM that cannot answer counts it as keyboard. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function EstateMap({ view }: { view: DocsView }) {
  const { dl } = useLifecycleViewModel();
  const base = useId();
  const { tiles } = view;
  const flat = useMemo(() => tiles.flatMap((t, ti) => t.docs.map((doc, k) => ({ doc, ti, k }))), [tiles]);
  // Each folder's first doc's flat index.
  const starts = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    for (const t of tiles) {
      out.push(n);
      n += t.docs.length;
    }
    return out;
  }, [tiles]);
  const [cursor, setCursor] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const [hover, setHover] = useState<{ i: number; rect: DOMRect } | null>(null);
  const cell = cellRem(flat.length);
  const last = flat.length - 1;
  const cur = Math.min(Math.max(0, cursor), Math.max(0, last));
  const idOf = (i: number) => `${base}-doc-${i}`;

  const jump = (by: -1 | 1) => {
    const at = flat[cur];
    if (!at) return;
    const ti = Math.min(Math.max(0, at.ti + by), tiles.length - 1);
    setCursor(starts[ti]! + Math.min(at.k, tiles[ti]!.docs.length - 1));
  };
  const pick = (i: number) => {
    const at = flat[i];
    if (at) view.pick(at.doc.docPath);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setCursor(Math.max(0, cur - 1)),
      ArrowRight: () => setCursor(Math.min(last, cur + 1)),
      ArrowUp: () => jump(-1),
      ArrowDown: () => jump(1),
      Home: () => setCursor(0),
      End: () => setCursor(last),
      Enter: () => pick(cur),
      ' ': () => pick(cur),
    };
    const act = keys[e.key];
    if (!act || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    setKeyboard(true);
    act();
  };

  const peekIndex = hover?.i ?? (keyboard ? cur : null);
  const peekEl = hover == null && peekIndex != null ? document.getElementById(idOf(peekIndex)) : null;
  const anchor = hover?.rect ?? (peekEl ? peekEl.getBoundingClientRect() : null);
  const peekDoc = peekIndex != null ? flat[peekIndex]?.doc : undefined;

  return (
    <div
      role="listbox"
      aria-label={dl.lcx7_estate_label}
      aria-activedescendant={flat.length > 0 ? idOf(cur) : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={(e) => setKeyboard(keyboardFocus(e.currentTarget))}
      onBlur={() => setKeyboard(false)}
      className={`flex min-w-0 flex-1 flex-wrap content-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${lcSurface('panel')}`}
      style={{ '--lcx7-cell': `${cell}rem` } as CSSProperties}
      data-testid="lcx7-estate"
    >
      {tiles.map((t, ti) => (
        <EstateTile
          key={t.dir || '.'}
          tile={t}
          prefix={view.prefix}
          start={starts[ti]!}
          cell={cell}
          filter={view.filter}
          selected={view.selected}
          cursor={keyboard ? cur : -1}
          idOf={idOf}
          onHover={(i, e) => setHover({ i, rect: e.currentTarget.getBoundingClientRect() })}
          onLeave={() => setHover(null)}
          onPick={(i) => { setCursor(i); pick(i); }}
        />
      ))}
      <AnchoredTooltip
        anchor={anchor}
        content={peekDoc ? <DocPeek row={peekDoc} filed={view.backlog.byDoc.has(peekDoc.docPath)} /> : null}
        placement="top"
      />
    </div>
  );
}
