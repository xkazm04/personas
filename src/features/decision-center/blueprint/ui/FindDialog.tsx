import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSheet } from '../controller/SheetContext';
import { stageWord } from '../controller/useBlueprintText';
import { findHits, type Hit } from '../model/find';
import { BpDialog } from './dialog/BpDialog';
import { Keycap } from './Keycap';
import { Press } from './Press';

/**
 * Find (/): wings, bays, features and queued work in one list. Up and Down pick, Enter flies there, Esc closes. The
 * input owns these keys itself (the sheet's window handler leaves a field alone). The box and the hits are bp's rail
 * Find (40 px field, accent focus ring, ruled result rows) in the sheet's dialog frame (BpDialog, over BaseModal).
 */
export function FindDialog() {
  const s = useSheet();
  const { B, tx } = s.text;
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findHits(s.plan, s.work, q), [s.plan, s.work, q]);
  useEffect(() => { setHi(0); }, [q]);
  // BaseModal focuses its first control on the next frame; the field takes it back after that
  useEffect(() => { const id = requestAnimationFrame(() => input.current?.focus()); return () => cancelAnimationFrame(id); }, []);
  const close = () => s.dispatch({ type: 'overlay', overlay: null });
  const go = (h: Hit | undefined) => {
    if (!h) return;
    close();
    if (h.kind === 'wing') s.nav.flyToPlace('wing', h.id);
    else if (h.kind === 'bay') s.nav.flyToPlace('bay', h.id);
    else if (h.kind === 'feature') s.nav.flyToFeature(h.id);
    else { const p = s.work.byId.get(h.id); if (p) s.nav.select(p, true); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[hi]); }
  };
  const detail = (h: Hit): string => {
    if (h.kind === 'wing') return tx(B.find_wing, { features: h.features, waiting: h.waiting });
    if (h.kind === 'bay') return tx(B.find_bay, { room: h.room });
    if (h.kind === 'feature') return tx(B.find_feature, { stage: h.stage ? stageWord(B, h.stage) : B.not_drawn, room: h.room });
    return tx(B.find_item, { lens: s.plan.LENS[h.lens]?.short ?? h.lens, feature: h.feature });
  };
  const kind = (h: Hit) => (h.kind === 'wing' ? B.find_kind_wing : h.kind === 'bay' ? B.find_kind_bay : h.kind === 'feature' ? B.find_kind_feature : B.find_kind_item);
  const title = (h: Hit) => (h.kind === 'wing' ? `${h.letter} · ${h.title}` : h.kind === 'bay' ? `${h.code} · ${h.title}` : h.title);
  return (
    <BpDialog
      onClose={close}
      titleId="bp-find-title"
      title={tx(B.find_title, { product: s.data.product.name })}
      sub={hits.length ? tx(B.find_matches, { count: hits.length }) : B.find_scope}
      footer={<><span><Keycap k="ArrowUp" /><Keycap k="ArrowDown" /> {B.hint_pick}</span><span><Keycap k="Enter" /> {B.hint_fly}</span><span><Keycap k="Escape" /> {B.hint_close}</span></>}
    >
      <input ref={input} className="bp-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={B.find_placeholder} aria-label={B.find_placeholder} autoComplete="off" data-testid="blueprint-find-input" />
      <div className="bp-hits" role="listbox" aria-label={B.find_title_aria}>
        {hits.map((h, i) => (
          <Press key={h.kind + h.id} tone="bp-hit" onClick={() => go(h)} current={i === hi} role="option" aria-selected={i === hi}>
            <span className="bp-kind">{kind(h)}</span><span className="bp-ht2">{title(h)}</span><span className="bp-d">{detail(h)}</span>
          </Press>
        ))}
        {!hits.length && <p className="bp-empty">{tx(B.find_none, { product: s.data.product.name })}</p>}
      </div>
    </BpDialog>
  );
}
