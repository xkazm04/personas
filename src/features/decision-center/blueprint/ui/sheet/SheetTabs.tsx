import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useSheet } from '../../controller/SheetContext';
import { verdictWord } from '../../controller/useBlueprintText';
import type { Feature } from '../../standard/load';
import { Press } from '../Press';

/**
 * The tab strip of the L4 page (bp FeatureSheet Tabs): GEN (the overview), then every enabled lens by its short code
 * over its name, a 7 px health square after the code, and the lens-coloured 3 px underline under the chosen tab
 * (it travels between tabs; under reduced motion it is simply there). The tab is the plan's lens, as in bp: choosing
 * one switches the plan's lens behind the page too, exactly as the digit keys do. The tablist and its panel are
 * SheetPage's (one file declares both); this renders the tabs inside it.
 */
export function SheetTabs({ f }: { f: Feature }) {
  const s = useSheet();
  const { B } = s.text;
  const reduce = useReducedMotion();
  const sl = s.ui.sheetLens;
  const tabs = [{ id: 'general', short: B.sheet_gen, name: B.sheet_overview }, ...s.plan.lenses.map((l) => ({ id: l.id, short: l.short, name: l.name }))];
  const choose = (id: string) => { s.dispatch({ type: 'lens', id }); s.dispatch({ type: 'sheetLens', id }); };
  return (
    <>
      {tabs.map((t) => {
        const lens = t.id !== 'general', h = lens ? f.lens[t.id]?.h ?? 'unmeasured' : null, on = sl === t.id;
        return (
          <Press key={t.id} onClick={() => choose(t.id)} role="tab" id={'bp-tab-' + t.id} aria-selected={on} aria-controls="bp-sheet-panel"
            aria-label={h ? t.name + ', ' + verdictWord(B, h) : t.name} data-testid={'blueprint-page-tab-' + t.id}>
            <span className="sh">{t.short}{h ? <i className={'hd ' + h} aria-hidden="true" /> : null}</span>
            <span className="nm">{t.name}</span>
            {on ? (reduce ? <span className="uline" /> : <motion.span layoutId="bp-pg-uline" className="uline" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />) : null}
          </Press>
        );
      })}
    </>
  );
}
