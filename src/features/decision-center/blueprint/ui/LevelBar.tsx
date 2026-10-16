import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSheet } from '../controller/SheetContext';
import { useViewLevel, useViewScale } from '../state/viewStore';
import { Press } from './Press';

const LEVELS = [0, 1, 2, 3, 4] as const;

/**
 * The level ladder (bp Overlays Ladder, blueprint.css:171-177): "- + LEVEL L0 SITE ... L4 FEATURE", 30 px on the card,
 * 12 px mono, the current level filled with the lens accent. Round one's NAMES cell closes it: how many feature names
 * the plan draws right now, the number that answers "why are there no names here" (zoom, or press Enter).
 */
export function LevelBar() {
  const s = useSheet();
  const { B, tx } = s.text;
  const lv = useViewLevel(s.view), sc = useViewScale(s.view);
  const n = s.ui.sheet ? 4 : lv.n;
  const name = (i: number) => [B.level_site, B.level_wing, B.level_room, B.level_bay, B.level_feature][i] ?? '';
  return (
    <nav className="bp-lv" aria-label={B.levels}>
      <Tooltip content={B.zoom_out} placement="top"><Press tone="zb" onClick={() => s.nav.zoom(1 / 1.35)} aria-label={B.zoom_out}>{'−'}</Press></Tooltip>
      <Tooltip content={B.zoom_in} placement="top"><Press tone="zb" onClick={() => s.nav.zoom(1.35)} aria-label={B.zoom_in}>+</Press></Tooltip>
      <span className="lvl" aria-hidden="true">{B.level_label}</span>
      {LEVELS.map((i) => (
        <Press key={i} current={i === n} onClick={() => s.nav.toLevel(i)} data-level={i}>{tx(B.level_n, { n: i, name: name(i) })}</Press>
      ))}
      {lv.lodHigh && !s.ui.sheet && (
        <Tooltip content={sc.names < sc.tiles ? B.names_hint_short : B.names_hint_all} placement="top">
          <span className="lvl bp-names" data-testid="blueprint-names">{tx(B.names, { names: sc.names, total: s.plan.S.features.length })}</span>
        </Tooltip>
      )}
    </nav>
  );
}

/** The scale bar (bp Overlays ScaleBar): "SCALE 1:83", and at the site a bar 7 px high for what one feature measures. */
export function ScaleReadout() {
  const s = useSheet();
  const { B, tx } = s.text;
  const lv = useViewLevel(s.view), sc = useViewScale(s.view);
  if (!sc.den) return null;
  const bar = lv.n === 0 && !s.ui.sheet;
  return (
    <div className="bp-scale" aria-hidden="true">
      <span>{tx(B.scale, { den: sc.den })}</span>
      {bar && <><i className="sb" style={{ width: `${Math.round(Math.max(10, 160 * (100 / sc.den)))}px` }} /><span className="tail">{B.one_feature}</span></>}
    </div>
  );
}
