// The one tooltip of the fused HUD. The field, the dock and the dial all
// point at the same element, so a node reads the same wherever the pointer
// found it: its kind and rank, its name, what it holds, what the council has
// said about it, and what a click will do. A council state the store has
// never measured says so in words; it is never a zero.
import { useLayoutEffect, useRef } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { GalaxyLayout, GalaxyNode } from '../engine/types';
import { careKinds, nodeTitle, parentCount, subjectsIn } from './fusedModel';
import { useFusedStore } from './fusedStore';
import { useFusedStrings, type FusedStrings } from './fusedStrings';

interface Props {
  layout: GalaxyLayout | null;
  waitingStars: Set<string>;
}

function figures(s: FusedStrings, n: GalaxyNode): string {
  if (n.kind === 'domain') {
    return s.tipDomain(n.categories.length, n.subjectCount, n.techniqueCount);
  }
  if (n.kind === 'category') return s.tipCategory(n.subjects.length, n.wedges.length, n.techniqueCount);
  if (n.kind === 'subject') return s.tipSubject(n.techniques.length, n.lawCount, n.applications, n.category.title);
  return s.tipTechnique(n.laws.length, n.useWhen.length, n.subject.title);
}

export function FieldTip({ layout, waitingStars }: Props) {
  const { t } = useTranslation();
  const s = useFusedStrings();
  const tip = useFusedStore((st) => st.tip);
  const ref = useRef<HTMLDivElement | null>(null);

  // Placed after it has laid out, against the stage it sits in, so a card
  // near an edge turns back into the room rather than leaving it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const host = el.offsetParent as HTMLElement | null;
    const W = host?.clientWidth ?? window.innerWidth;
    const H = host?.clientHeight ?? window.innerHeight;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let x = tip.x + 16;
    let y = tip.above ? tip.y - th : tip.y + 16;
    if (x + tw > W - 8) x = tip.x - tw - 16;
    if (y + th > H - 8) y = tip.y - th - 16;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
  }, [tip]);

  const n = tip?.node ?? null;
  let council: { text: string; tone: string } | null = null;
  let waits = false;
  if (n?.kind === 'subject') {
    const o = n.overlay;
    council = o
      ? { text: s.tipCouncil(o.approved, o.rejected, o.pending, o.techniquesProven, n.techniques.length), tone: `var(--gx-${n.mark === 'approved' ? 'ok' : n.mark === 'rejected' ? 'err' : 'warn'})` }
      : { text: s.tipNever, tone: 'var(--muted)' };
    waits = waitingStars.has(n.slug);
  } else if (n && layout && (n.kind === 'domain' || n.kind === 'category')) {
    const care = subjectsIn(layout, n).filter((x) => careKinds(x, waitingStars).length > 0).length;
    if (care) council = { text: s.tipCare(care), tone: 'var(--gx-warn)' };
  }

  return (
    <div ref={ref} className={`fz-tip${n ? ' on' : ''}`} role="tooltip" data-role="hud-tip">
      {n && layout ? (
        <>
          <div className="k">{s.kindIndex(n.kind, n.rank, parentCount(layout, n))}</div>
          <div className="n">{nodeTitle(n)}</div>
          <div className="f">{figures(s, n)}</div>
          {council ? (
            <div className="cz" style={{ color: council.tone }}>
              {council.text}
            </div>
          ) : null}
          {waits ? (
            <div className="cz" style={{ color: 'var(--gx-warn)' }}>
              {t.council.fused.tip_waits_here}
            </div>
          ) : null}
          <div className="go">{n.kind === 'technique' ? s.clickOpen(nodeTitle(n)) : s.clickFly(nodeTitle(n))}</div>
        </>
      ) : null}
    </div>
  );
}

export default FieldTip;
