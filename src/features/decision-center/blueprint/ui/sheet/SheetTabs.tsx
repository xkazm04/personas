import type { ReactNode } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { Press } from '../Press';

/**
 * The lens tabs of the L4 sheet and the panel they choose: General (the overview), then one tab per lens, each with a
 * mark when the feature is measured under it. Selecting a tab filters the lens cards and the work shown in the panel.
 * `wide`: the compare panel is open, so the panel splits into the feature and the compare, each scrolling on its own.
 */
export function SheetTabs({ fid, wide, children }: { fid: string; wide?: boolean; children: ReactNode }) {
  const s = useSheet();
  const { B } = s.text;
  const T = s.plan.L.TILE[fid];
  if (!T) return null;
  const f = T.f, sl = s.ui.sheetLens;
  const tabs = [{ id: 'general', short: B.sheet_gen, name: B.sheet_overview }, ...s.plan.lenses.map((l) => ({ id: l.id, short: l.short, name: l.name }))];
  return (
    <>
      <div className="bp-tabs-bar">
        <div className="bp-tabs" role="tablist" aria-label={B.sheets}>
          {tabs.map((t) => {
            const v = t.id === 'general' ? null : f.lens[t.id]?.h;
            return (
              <Press key={t.id} tone="bp-tab" on={sl === t.id} onClick={() => s.dispatch({ type: 'sheetLens', id: t.id })} role="tab" id={"bp-tab-" + t.id} aria-selected={sl === t.id} aria-controls="bp-sheet-panel" aria-label={t.name}>
                <span className="bp-s typo-code">{t.short}{v ? <i className={v !== 'unmeasured' && v !== 'na' ? 'bp-m' : ''} /> : null}</span>
                <span className="typo-body">{t.name}</span>
              </Press>
            );
          })}
        </div>
      </div>
      <div className={wide ? 'bp-body bp-cmp-on' : 'bp-body'} role="tabpanel" id="bp-sheet-panel" aria-labelledby={"bp-tab-" + sl}>{children}</div>
    </>
  );
}
