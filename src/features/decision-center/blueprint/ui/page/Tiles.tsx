// General's headline tiles (bp page/General.tsx Tile, StatTiles): one per enabled lens, its headline value, health
// word and reason, with a 3 px health top border. A tile opens that lens's tab (and the plan's lens with it, as the
// digit keys do). On a past date health has no history: the tile says so and shows only a reading the scan recorded.
import { useSheet } from '../../controller/SheetContext';
import { reasonOf } from '../../standard/present';
import { fval, type Feature, type LensDef } from '../../standard/load';
import { Press } from '../Press';
import { useAsOf, useHealthWord, Val } from './bits';
import { Sec, Stagger } from './motion';
import { valueView } from './readings';
import { dayFmt } from './values';

function Tile({ f, d }: { f: Feature; d: LensDef }) {
  const s = useSheet(), { B, tx, language } = s.text, word = useHealthWord();
  const { t, now, past } = useAsOf();
  const fl = f.lens[d.id], hf = d.headline;
  const at = hf ? valueView(s.work.series, f, d.id, hf, t, now) : { at: 'none' as const };
  const then = at.at === 'then' ? at : null;
  const h = past ? 'unmeasured' : fl?.h ?? 'unmeasured', why = fl ? reasonOf(fl) : null;
  const shown = hf && (past ? then : h !== 'na');
  const open = () => { s.dispatch({ type: 'lens', id: d.id }); s.dispatch({ type: 'sheetLens', id: d.id }); };
  return (
    <Sec as="div" className={'pg-tile bp-lc ' + h}>
      <Press onClick={open} aria-label={tx(B.pg_tile_open, { name: d.name })} data-lens={d.id}>
        <span className="top"><span className="sh">{d.short}</span><span className="nm">{d.name}</span><span className="hw">{past ? B.pg_not_recorded : word(h)}</span></span>
        <span className="lab">{hf ? hf.label : B.pg_no_headline}</span>
        <b className="big">{shown && hf ? <Val k={f.id + ':' + d.id + ':' + hf.key} field={hf} v={then ? then.value : fval(f, d.id, hf.key)} /> : '—'}</b>
        <span className="why">
          {past ? (then ? tx(B.pg_read_on, { date: dayFmt(language, then.measured) }) : B.pg_nr_date)
            : h === 'na' ? B.pg_na_here : why ?? (h === 'unmeasured' ? B.pg_nothing_measured : B.card_no_rule)}
        </span>
      </Press>
    </Sec>
  );
}

/** Every lens at a glance: the tiles, entering first. */
export function StatTiles({ f }: { f: Feature }) {
  const s = useSheet();
  return <Stagger className="pg-tiles" gap={0.04}>{s.plan.lenses.map((d) => <Tile key={d.id} f={f} d={d} />)}</Stagger>;
}
