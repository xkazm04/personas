import { Minus, Plus } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSheet } from '../controller/SheetContext';
import { useViewLevel, useViewScale } from '../state/viewStore';
import { Press } from './Press';

const LEVELS = [0, 1, 2, 3, 4] as const;

/**
 * The level bar (bp BaseBar): zoom, the five levels as one band (L0 site .. L4 feature, the current one inked, the
 * ones passed shaded) and the NAMES cell, which says how many feature names the plan is drawing right now: the
 * number that makes "why are there no names here" answerable (zoom or press Enter).
 */
export function LevelBar() {
  const s = useSheet();
  const { B, tx } = s.text;
  const lv = useViewLevel(s.view), sc = useViewScale(s.view);
  const n = s.ui.sheet ? 4 : lv.n;
  const label = (i: number) => tx(B.level_n, { n: i, name: [B.level_site, B.level_wing, B.level_room, B.level_bay, B.level_feature][i] ?? '' });
  return (
    <div className="bp-lv" role="toolbar" aria-label={B.levels}>
      <Press onClick={() => s.nav.zoom(1 / 1.35)} aria-label={B.zoom_out}><Minus aria-hidden="true" /></Press>
      <Press onClick={() => s.nav.zoom(1.35)} aria-label={B.zoom_in}><Plus aria-hidden="true" /></Press>
      <span className="bp-tag typo-code">{B.level_label}</span>
      {LEVELS.map((i) => (
        <Press key={i} tone={i < n ? 'bp-past' : undefined} current={i === n} onClick={() => s.nav.toLevel(i)} data-level={i}>
          <span className="typo-code">{label(i)}</span>
        </Press>
      ))}
      {lv.lodHigh && !s.ui.sheet && (
        <Tooltip content={sc.names < sc.tiles ? B.names_hint_short : B.names_hint_all} placement="top">
          <span className="bp-tag bp-names typo-code" data-testid="blueprint-names">{tx(B.names, { names: sc.names, total: s.plan.S.features.length })}</span>
        </Tooltip>
      )}
    </div>
  );
}

/** The scale readout (bp BaseBar): "SCALE 1:83", and at the site a bar for what one feature measures. */
export function ScaleReadout() {
  const s = useSheet();
  const { B, tx } = s.text;
  const lv = useViewLevel(s.view), sc = useViewScale(s.view);
  if (!sc.den) return null;
  return (
    <div className="bp-scale typo-code" aria-hidden="true">
      {tx(B.scale, { den: sc.den })}
      {lv.n === 0 && !s.ui.sheet && <><i className="bp-scalebar" style={{ width: `${Math.round(160 * (100 / sc.den))}px` }} /> {B.one_feature}</>}
    </div>
  );
}
