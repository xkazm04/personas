// The legend (PORTED from bp src/components/Legend.tsx and variants/subtle/Legend.tsx, the adopted lens expression):
// General shows the lens strip's key (each lens's glyph and line type, in registry order), the stage swatches and the
// marks the plan draws; a lens sheet shows what its fill measures, the "?" and the fade, then sample fixtures drawn with
// that lens alone. Every specimen is the plan's own drawing (Specimens.tsx).
// EDIT (port): bp's agent states (working, waiting, blocked, failed) and standing-order marks belong to its simulated
// swarm, which this plan does not draw; the plan's finding pennants (waiting, approved not built) take their rows. bp's
// `?lenses=` sentence is not brought (no such switch here), nor the count clause of the fill sentence (the engine keeps
// the count field private: engine/lens.ts countField).
import { useMemo } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import { lensContent } from '../../engine/lens';
import type { Feature, LensDef, Stage } from '../../standard/load';
import { FlagSpecimen, HealthSpecimen, LensSwatch, LensTile, PinSpecimen, SampleTile, StageSwatch } from './Specimens';
import { DeltaMark } from './Symbols';

/** The stages in bp's legend order. */
export const LEGEND_STAGES: readonly Stage[] = ['live', 'flagged', 'in-review', 'in-dev', 'specified', 'idea', 'deprecated'];

function anyUnscanned(fs: readonly Feature[], ids: readonly string[]): boolean {
  return fs.some((f) => {
    let unknown = false;
    for (const l of ids) { const h = f.lens[l]?.h ?? 'unmeasured'; if (h === 'unmeasured') unknown = true; else if (h !== 'na') return false; }
    return unknown;
  });
}

/** The General key: every stage, the flags, the trouble marks, the delta and the pennants. */
function BaseKey() {
  const s = useSheet();
  const { B, tx } = s.text;
  return (
    <div className="lg" data-testid="blueprint-legend-stages">
      {LEGEND_STAGES.map((st) => <div key={st} data-stage={st}><StageSwatch st={st} /><span>{stageWord(B, st)}</span></div>)}
      <div><FlagSpecimen bad count={1} /><span>{B.leg_flag}</span></div>
      <div><FlagSpecimen bad={false} count={3} /><span>{B.leg_flag_count}</span></div>
      <div><HealthSpecimen k="bar" /><span>{B.leg_bar}</span></div>
      <div><HealthSpecimen k="cloud" /><span>{B.leg_cloud}</span></div>
      <div><HealthSpecimen k="tick" /><span>{B.leg_tick}</span></div>
      <div><DeltaMark /><span>{tx(B.leg_delta, { days: s.ui.viewDays })}</span></div>
      <div><PinSpecimen state="med" /><span>{B.leg_pin_waiting}</span></div>
      <div><PinSpecimen state="high" /><span>{B.leg_pin_high}</span></div>
      <div><PinSpecimen state="ok" /><span>{B.leg_pin_ok}</span></div>
      <div className="lg-note">{tx(B.leg_note, { count: s.plan.lenses.length })}</div>
    </div>
  );
}

/** What a lens's fill measures, in words, from its manifest. */
function useFillWords(d: LensDef): string {
  const { B, tx } = useSheet().text;
  const m = d.measures, line = B[`leg_line_${d.line}`];
  const what = m ? tx(B.leg_fill_what, { label: m.label.toLowerCase() }) : B.leg_fill_none;
  const range = m?.type === 'enum' && m.values.length ? tx(B.leg_fill_range, { from: m.values[0]!, to: m.values[m.values.length - 1]! })
    : m?.type === 'percent' ? tx(B.leg_fill_range, { from: '0', to: '100%' }) : m && 'max' in m && m.max !== undefined ? tx(B.leg_fill_range, { from: '0', to: String(m.max) }) : '';
  return tx(B.leg_fill, { what, line: line.toLowerCase() }) + (range ? ' ' + range : '');
}

/** A lens sheet's key: its fill, the "?" and the fade, then sample fixtures whose evidence differs. */
function LensKey({ d }: { d: LensDef }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const fill = useFillWords(d);
  const samples = useMemo(() => {
    const seen = new Map<string, Feature>(), e = s.engine;
    if (!e) return [];
    for (const f of s.plan.S.features) {
      if (!f.stage) continue;
      const k = lensContent(s.words, d, f, e.live(f)).parts[0] ?? '';
      if (k && !seen.has(k)) seen.set(k, f);
      if (seen.size >= 6) break;
    }
    return [...seen.entries()];
  }, [s.plan, s.engine, s.words, d]);
  return (
    <>
      <div className="sl-key">
        <div className="sl-one"><LensTile d={d} kind="fill" /><span><b>{B.leg_fill_word}</b> {fill}</span></div>
        <div className="sl-one"><LensTile d={d} kind="unknown" /><span><b>?</b> {B.leg_unknown}</span></div>
        <div className="sl-one"><LensTile d={d} kind="faded" /><span><b>{B.leg_faded_word}</b> {B.leg_faded}</span></div>
      </div>
      <div className="lg">
        {samples.map(([label, f]) => <div key={label}><SampleTile d={d} f={f} /><span>{label.toLowerCase()}</span></div>)}
        <div><HealthSpecimen k="cloud" /><span>{tx(B.leg_lens_bad, { lens: d.name })}</span></div>
        <div><HealthSpecimen k="tick" /><span>{B.leg_tick}</span></div>
      </div>
    </>
  );
}

/** The legend of the sheet in view: General, or the lens whose sheet is up. */
export function Legend() {
  const s = useSheet();
  const { B } = s.text;
  const d = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  const ids = useMemo(() => s.plan.lenses.map((l) => l.id), [s.plan]);
  const unscanned = useMemo(() => anyUnscanned(s.plan.S.features, ids), [s.plan, ids]);
  if (d) return <div className="bp-lgnd"><LensKey d={d} /></div>;
  return (
    <div className="bp-lgnd" data-testid="blueprint-legend">
      <div className="sl-key">
        <p>{B.leg_strip}</p>
        <div className="sl-grid">{s.plan.lenses.map((l) => <div key={l.id}><LensSwatch d={l} /><span>{l.name}</span></div>)}</div>
        {unscanned && <div className="sl-one"><LensTile d={null} kind="unknown" /><span><b>?</b> {B.leg_unscanned}</span></div>}
      </div>
      <BaseKey />
    </div>
  );
}
