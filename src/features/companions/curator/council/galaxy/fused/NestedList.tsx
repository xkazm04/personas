// The level below where the reader stands, as a numbered list with counts
// and care marks: an amber figure per domain or category for how many of its
// subjects need care, a claim dot per subject. The row the reader rests on
// (pointer, arrow keys, or the field under the pointer) opens in place and
// shows its own children, one level deeper, before any click commits.
import { useLayoutEffect, useRef } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout, GalaxyNode } from '../engine/types';
import { childrenOf, countOf, focusNode, needsCare, nodeTitle, subjectsIn } from './fusedModel';
import { useFusedStore } from './fusedStore';
import { useFusedStrings } from './fusedStrings';

interface Props {
  engine: GalaxyEngine | null;
  layout: GalaxyLayout;
  path: EnginePath;
  waitingStars: Set<string>;
}

const MARK_TONE: Record<string, string> = { approved: 'var(--gx-ok)', rejected: 'var(--gx-err)', pending: 'var(--gx-warn)' };
const OPEN_MAX = 12;

/** The list is the field's non-pointer alternative; the canvas points here. */
export const LIST_ID = 'council-fused-list';

/** The rows the list shows: a pinned technique's siblings, else the level below. */
export function listKids(layout: GalaxyLayout, path: EnginePath): GalaxyNode[] {
  if (path.technique) return path.technique.subject.techniques;
  return childrenOf(layout, focusNode(path));
}

export function NestedList({ engine, layout, path, waitingStars }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const cursor = useFusedStore((st) => st.cursor);
  const filters = useFusedStore((st) => st.filters);
  const setCursor = useFusedStore((st) => st.setCursor);
  const listRef = useRef<HTMLOListElement | null>(null);
  const kids = listKids(layout, path);
  const lvl = path.technique ? 3 : path.subject ? 3 : path.category ? 2 : path.domain ? 1 : 0;
  const noun = path.technique ? f.list_techniques_here : [f.list_domains, f.list_categories, f.list_subjects, f.list_techniques][lvl];
  const each = [f.list_each_subjects, f.list_each_subjects, f.list_each_techniques, f.list_each_laws][lvl];

  // An opened row brings its nested children into view with it.
  useLayoutEffect(() => {
    const list = listRef.current;
    const cur = list?.querySelector<HTMLElement>('.it.cur, .it.pinned')?.parentElement;
    if (!list || !cur) return;
    const top = cur.offsetTop - list.offsetTop;
    const bottom = top + cur.offsetHeight;
    if (top < list.scrollTop || cur.offsetHeight > list.clientHeight) list.scrollTop = top - 2;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 2;
  }, [cursor, path]);

  const mark = (c: GalaxyNode) => {
    if (c.kind === 'subject') {
      const tone = MARK_TONE[c.mark] ?? (waitingStars.has(c.slug) ? 'var(--gx-warn)' : null);
      return tone ? <i className="dot" style={{ background: tone }} /> : null;
    }
    if (c.kind === 'domain' || c.kind === 'category') {
      const n = subjectsIn(layout, c).filter((x) => needsCare(x, waitingStars, filters)).length;
      return n ? (
        <span className="cb" data-role="hud-care-count">
          {s.n(n)}
        </span>
      ) : null;
    }
    return null;
  };
  const row = (c: GalaxyNode, cls: string) => (
    <button
      className={`it${cls}`}
      type="button"
      data-role="hud-tree-row"
      onClick={() => engine?.goTo(c)}
      onMouseEnter={() => engine?.setHover(c)}
    >
      <span className="rk">{c.rank}</span>
      <span className="t">{nodeTitle(c)}</span>
      <span className="ct">
        {mark(c)}
        {s.n(countOf(c))}
      </span>
    </button>
  );

  return (
    <section className="fz-tree" id={LIST_ID} aria-label={f.list_label}>
      <h3 data-role="hud-tree-head">
        <span>
          {noun} · {s.n(kids.length)} <kbd>1–{Math.min(9, kids.length)}</kbd>
        </span>
        <span className="k">
          {lvl < 2 ? <span className="care">{f.list_care}</span> : null}
          {lvl < 2 ? ' · ' : null}
          {each}
        </span>
      </h3>
      <ol ref={listRef} onMouseLeave={() => engine?.setHover(null)}>
        {kids.map((c) => {
          const cur = c === cursor;
          const kidsOf = cur && c.kind !== 'technique' ? childrenOf(layout, c) : [];
          return (
            <li key={`${c.kind}:${c.rank}`} onMouseEnter={() => setCursor(c)}>
              {row(c, `${cur ? ' cur' : ''}${path.technique === c ? ' pinned' : ''}`)}
              {kidsOf.length ? (
                <ol className="sub">
                  {kidsOf.slice(0, OPEN_MAX).map((g) => (
                    <li key={`${g.kind}:${g.rank}`}>{row(g, path.technique === g ? ' pinned' : '')}</li>
                  ))}
                  {kidsOf.length > OPEN_MAX ? <li className="more">{tx(f.list_more, { count: kidsOf.length - OPEN_MAX })}</li> : null}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default NestedList;
