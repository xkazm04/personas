import { memo, useRef, useState } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { bboxCells, GRID_H, GRID_W, type PixGrid } from '../../model/ledgerPixels';
import { Press } from '../Press';
import { ShotFigure, UrlImg } from './ShotFrame';
import type { ShotState } from './useShotUrl';
import type { MapState } from './useChangeMap';

type Got = ShotState | undefined;

/** A share in percent (0..100) in the sheet's language, to two decimals as bp prints it. */
export const pctOf = (language: string, v: number): string => new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 }).format(v / 100);

/** The change map's overlay (bp ChangeMap): a rect per grid cell where a pixel moved (opacity grows with the change),
 *  and the dashed box around every moved pixel, as an SVG over the after screen. */
export const ChangeMap = memo(function ChangeMap({ grid }: { grid: PixGrid }) {
  const box = bboxCells(grid);
  return (
    <svg className="tr-heat" viewBox={`0 0 ${GRID_W} ${GRID_H}`} preserveAspectRatio="none" aria-hidden="true">
      {grid.cells.map((d, i) => (d ? <rect key={i} x={i % GRID_W} y={Math.floor(i / GRID_W)} width="1" height="1" opacity={Math.min(1, 0.35 + d / 160).toFixed(2)} /> : null))}
      {box ? <rect className="bb" x={box.x} y={box.y} width={box.w} height={box.h} /> : null}
    </svg>
  );
});

/** The slider (bp Screens Slider): the after clipped over the before at --cut; the range input sets the variable on the
 *  frame, so dragging never re-renders React. A native range input is the control: the arrows move it. */
export function Slider({ theme, before, after }: { theme: string; before: Got; after: Got }) {
  const { B, tx } = useSheet().text;
  const frame = useRef<HTMLDivElement>(null);
  return (
    <ShotFigure cap={tx(B.cmp_slider_cap, { theme })} aside={B.lg_cmp_slider_aside} frameRef={frame}>
      <UrlImg got={before} alt={tx(B.cmp_shot_before, { theme })} />
      <UrlImg got={after} alt={tx(B.cmp_shot_after, { theme })} className="top" />
      <span className="tr-tagb">{B.lg_cmp_before}</span><span className="tr-taga">{B.lg_cmp_after}</span>
      <input type="range" min="0" max="100" defaultValue="50" aria-label={B.cmp_slider_label}
        onInput={(e) => frame.current?.style.setProperty('--cut', e.currentTarget.value + '%')} />
      <span className="tr-knob" />
    </ShotFigure>
  );
}

/** Blink (bp Screens Blink): before and after swapping every 0.7 s (CSS); under reduced motion a toggle shows one or
 *  the other instead. */
export function Blink({ theme, before, after }: { theme: string; before: Got; after: Got }) {
  const { B, tx } = useSheet().text;
  const [on, setOn] = useState(false);
  const aside = (
    <>
      <span className="tr-blink-a">{B.lg_cmp_blink_aside}</span>
      <Press tone="tr-blink-t" on={on} onClick={() => setOn(!on)}>{on ? B.lg_cmp_blink_showing_after : B.lg_cmp_blink_showing_before}</Press>
    </>
  );
  return (
    <ShotFigure cap={tx(B.lg_cmp_blink_cap, { theme })} aside={aside} frame={'blink' + (on ? ' after-on' : '')}>
      <UrlImg got={before} alt={tx(B.cmp_shot_before, { theme })} />
      <UrlImg got={after} alt={tx(B.cmp_shot_after, { theme })} className="aft" />
    </ShotFigure>
  );
}

/** The change map (bp Screens): the after, dimmed, with the changed pixels marked, and the share that moved. */
export function MapView({ theme, after, map }: { theme: string; after: Got; map: MapState | undefined }) {
  const { B, tx, language } = useSheet().text;
  const aside = map?.status === 'done' ? tx(B.lg_cmp_moved_pct, { pct: pctOf(language, map.grid.moved) }) : map?.status === 'error' ? B.lg_cmp_map_failed : B.lg_cmp_computing;
  return (
    <ShotFigure cap={tx(B.lg_cmp_map_cap, { theme })} aside={aside}>
      <UrlImg got={after} alt={tx(B.cmp_shot_after, { theme })} className="dim" />
      {map?.status === 'done' ? <ChangeMap grid={map.grid} /> : <span className="tr-computing">{B.lg_cmp_computing}</span>}
    </ShotFigure>
  );
}
