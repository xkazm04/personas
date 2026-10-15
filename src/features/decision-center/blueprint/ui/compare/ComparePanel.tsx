import { useMemo } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSheet } from '../../controller/SheetContext';
import { keysFor } from '../../model/keymap';
import { comparisonOf, packOrder, placeInPack } from '../../model/triage';
import { Keycap } from '../Keycap';
import { LensGlyphIcon } from '../LensGlyphIcon';
import { StatusChip } from '../StatusChip';
import { CompareBody } from './CompareBody';
import { TriageBar } from './TriageBar';

/**
 * The compare panel (bp ComparePanel, the release ledger's side sheet), docked in the L4 feature sheet beside the
 * feature: one built item's evidence, so the operator triages it while seeing what it changed. The head names the item
 * (lens, id, pack and its place in it, feature, title) with previous / next (K / J walk every built item in pack order)
 * and close (Esc); the body is CompareBody, keyed by the item so its local state resets; the foot is the item's state
 * over the triage strip. Everything is read from the store's rows through compare.ts; nothing is decided here.
 */
export function ComparePanel({ id }: { id: string }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const c = useMemo(() => comparisonOf(s.data.scan, s.plan, id), [s.data.scan, s.plan, id]);
  const p = s.work.byId.get(id);
  const order = useMemo(() => packOrder(s.work, s.ui.sheetLens), [s.work, s.ui.sheetLens]);
  const at = order.findIndex((x) => x.id === id);
  const close = () => s.nav.compare(null);
  const nav = (
    <div className="bp-cmp-nav">
      <Button variant="ghost" size="icon-sm" onClick={() => s.nav.step(-1)} disabled={order.length < 2} aria-label={B.cmp_prev} data-testid="blueprint-cmp-prev"><ChevronUp className="w-4 h-4" /></Button>
      <Button variant="ghost" size="icon-sm" onClick={() => s.nav.step(1)} disabled={order.length < 2} aria-label={B.cmp_next} data-testid="blueprint-cmp-next"><ChevronDown className="w-4 h-4" /></Button>
      <Button variant="ghost" size="icon-sm" onClick={close} aria-label={B.cmp_close} data-testid="blueprint-cmp-close"><X className="w-4 h-4" /></Button>
    </div>
  );
  if (!c || !p) {
    return (
      <section className="bp-cmp" aria-label={B.cmp_title} data-testid="blueprint-compare">
        <header className="bp-cmp-h"><div className="bp-cmp-tt"><span className="typo-eyebrow">{B.cmp_title}</span><h3 className="typo-heading">{id}</h3></div>{nav}</header>
        <p className="bp-empty typo-body">{B.cmp_not_found}</p>
      </section>
    );
  }
  const L = s.plan.LENS[p.lens];
  const place = placeInPack(s.work, p);
  return (
    <section className="bp-cmp" aria-labelledby="bp-cmp-title" data-testid="blueprint-compare" data-item={p.id} data-status={p.status}>
      <header className="bp-cmp-h">
        <div className="bp-cmp-tt">
          <span className="typo-eyebrow bp-cmp-eb">
            {place ? tx(B.cmp_eyebrow, { pack: p.pack ?? '', n: place.n, count: place.of }) : B.cmp_title}
            {at >= 0 ? <span className="bp-kcs"><Keycap k={keysFor('prev')[0] ?? 'k'} /><Keycap k={keysFor('next')[0] ?? 'j'} /></span> : null}
          </span>
          <h3 className="typo-heading bp-cmp-title" id="bp-cmp-title">
            <span className="bp-g"><LensGlyphIcon glyph={L?.glyph ?? null} /></span>{p.title}
          </h3>
          <span className="bp-cmp-meta typo-code">
            <span>{L?.short ?? p.lens}</span><span>{p.id}</span><span>{p.f.name}</span><StatusChip B={B} status={p.status} />
          </span>
        </div>
        {nav}
      </header>
      <CompareBody key={p.id} c={c} p={p} />
      <TriageBar p={p} />
    </section>
  );
}
