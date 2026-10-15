import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSheet } from '../controller/SheetContext';
import type { LensDef } from '../standard/load';
import { LensGlyphIcon } from './LensGlyphIcon';
import { Press } from './Press';
import { sheetNumber } from './TitleBlock';

/**
 * The sheets (bp Header, commit 36c6126): General plus one tab per ENABLED lens of the map, in the map's order, each
 * as its short code, the count of work waiting under it and its digit key; the full name rides a tooltip. The seven
 * built-in lenses (Performance among them) fill the first row; custom PROJECT lenses (a reverse-DNS id such as
 * com.registry.xkazm04, drawn with the manifest's own glyph path) sit on a second row.
 */
export function LensTabs() {
  const s = useSheet();
  const { B } = s.text;
  const waitingBy = (id: string) => s.work.items.filter((p) => p.status === 'proposed' && p.lens === id).length;
  const set = (id: string) => { s.dispatch({ type: 'lens', id }); if (s.ui.sheet) s.dispatch({ type: 'sheetLens', id }); };
  const tab = (l: LensDef, glyph = false) => {
    const n = waitingBy(l.id), key = l.i + 2;
    return (
      <Tooltip key={l.id} content={l.name} placement="bottom">
        <Press on={s.ui.lens === l.id} onClick={() => set(l.id)} aria-label={l.name} data-lens={l.id}>
          {glyph && <span className="bp-tg"><LensGlyphIcon glyph={l.glyph} /></span>}
          <span className="typo-label">{l.short}</span>
          {n > 0 && <span className="bp-n typo-code">{n}</span>}
          <span className="bp-k typo-code">{key <= 9 ? key : ''}</span>
        </Press>
      </Tooltip>
    );
  };
  const builtin = s.plan.lenses.filter((l) => l.source === 'builtin'), custom = s.plan.lenses.filter((l) => l.source !== 'builtin');
  return (
    <div className="bp-sheets-col" role="toolbar" aria-label={B.sheets}>
      <div className="bp-sheets">
        <Press on={s.ui.lens === 'general'} onClick={() => set('general')} aria-label={B.general_arrangement}>
          <span className="typo-label">{sheetNumber(null, 0)}</span><span className="bp-k typo-code">1</span>
        </Press>
        {builtin.map((l) => tab(l))}
      </div>
      {custom.length > 0 && <div className="bp-sheets bp-custom" data-testid="blueprint-custom-lenses">{custom.map((l) => tab(l, true))}</div>}
    </div>
  );
}
