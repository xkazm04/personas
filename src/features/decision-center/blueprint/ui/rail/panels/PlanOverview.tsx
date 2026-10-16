// The Plan workbench's overview (PORTED from bp src/components/rail/wide/plan.tsx Overview): the legend of the sheet
// in view, trouble by lens (a lens opens its sheet), the drawing's title block and the keys.
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useSheet } from '../../../controller/SheetContext';
import type { BpText } from '../../../controller/useBlueprintText';
import { KEYMAP, type KeyAct, type KeyGroup } from '../../../model/keymap';
import { sheetNumber } from '../../header/ProjLine';
import { Keycaps } from '../../Keycap';
import { Legend } from '../../legend/Legend';
import { LensGlyphIcon } from '../../LensGlyphIcon';
import { Press } from '../../Press';
import { Sec } from './shell';
import { TitleBlockTbk } from './TitleBlockTbk';

/** The keys the plan answers to (the key sheet's own sentences; the decide and triage keys live in the Build queue). */
const KEYS: Partial<Record<KeyAct, keyof BpText>> = {
  enter: 'key_enter', back: 'key_back', wingNext: 'key_wing_next', wingPrev: 'key_wing_prev', site: 'key_site', zoomOut: 'key_zoom_out', zoomIn: 'key_zoom_in',
  find: 'key_find', lens: 'key_lens', ledger: 'key_ledger', timeline: 'key_timeline', help: 'key_help',
};
const KEY_GROUPS: readonly KeyGroup[] = ['move', 'walk', 'sheets'];

export function PlanOverview() {
  const s = useSheet();
  const { B, tx } = s.text;
  const kc = useMemo(() => {
    const kc: Record<string, { bad: number; watch: number }> = {};
    for (const f of s.plan.S.features) for (const t of f.trouble) { const c = (kc[t.lens] ??= { bad: 0, watch: 0 }); c[t.h]++; }
    return kc;
  }, [s.plan]);
  const L = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  return (
    <>
      <Sec head={tx(B.plan_legend, { sheet: sheetNumber(L ? L.short : null) })} aside={L ? L.name : B.general_arrangement}><Legend /></Sec>
      <div className="wb-cols">
        <Sec head={B.plan_trouble_by_lens} aside={B.plan_click_sheet}>
          <ul className="wb-kn" aria-label={B.plan_trouble_by_lens}>
            {s.plan.lenses.map((d) => {
              const c = kc[d.id] ?? { bad: 0, watch: 0 }, on = s.ui.lens === d.id;
              return (
                <li key={d.id}>
                  <Press on={on} style={{ '--bp-lens': s.engine?.accentOf(d.id) } as CSSProperties} onClick={() => s.dispatch({ type: 'lens', id: on ? 'general' : d.id })}>
                    <LensGlyphIcon glyph={d.glyph} /><b>{d.short}</b><span>{d.name}</span>
                    <span className="c">{tx(B.plan_kn_counts, { bad: c.bad, watch: c.watch })}</span>
                  </Press>
                </li>
              );
            })}
          </ul>
        </Sec>
        <Sec head={B.plan_title_block}><TitleBlockTbk /></Sec>
      </div>
      <Sec head={B.plan_keys}>
        <div className="wb-keys">
          {KEYMAP.filter((b) => KEY_GROUPS.includes(b.group) && KEYS[b.act]).map((b) => (
            <div key={b.act}><span><Keycaps keys={b.keys} max={b.act === 'lens' ? 1 : 2} /></span><span>{B[KEYS[b.act]!]}</span></div>
          ))}
        </div>
      </Sec>
    </>
  );
}
