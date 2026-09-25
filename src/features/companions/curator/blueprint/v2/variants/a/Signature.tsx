/**
 * THE SIGNATURE: the nine reasons as one mark, read left to right.
 *
 * The shipped page gives each reason a column. At half width there is no room
 * for nine columns, so the nine become nine 10px slots - position is identity,
 * and the ruler above the list carries the channel numbers on the same grid,
 * so a reader names a reason by reading down, not by hovering. The tip carries
 * the sentences; the mark carries the shape.
 *
 * Height is a BAND, not a continuous scale: under 2px of difference is not
 * visible at 18px, so five bands against the plan's own largest cell are more
 * honest than a ramp that pretends to a precision the eye cannot take.
 */
import type { CSSProperties } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { CHANNELS, type ChannelId } from '@/features/companions/curator/blueprint/model/channels';
import type { CellMark } from '@/features/companions/curator/blueprint/model/types';

import './signature.css';

/** Bar heights in px, one per band. A 1-point hit still has to be visible. */
const BAND_H = [4, 7, 10, 14, 18] as const;
/** Band edges as a share of the plan's largest single cell. */
const BAND_AT = [0.05, 0.15, 0.35, 0.65] as const;

function bandHeight(points: number, max: number): number {
  const share = max > 0 ? points / max : 0;
  const i = BAND_AT.findIndex((edge) => share <= edge);
  return BAND_H[i === -1 ? BAND_H.length - 1 : i]!;
}

const SLOT_CLASS: Record<CellMark['kind'], string> = {
  scored: 'bpa-slot bpa-slot--scored',
  'measured-zero': 'bpa-slot bpa-slot--zero',
  unknown: 'bpa-slot bpa-slot--unknown',
  unmeasurable: 'bpa-slot bpa-slot--unmeasurable',
};

/** How each cell reads, in one word, for the accessible name and the legend. */
export const INK_WORD: Record<CellMark['kind'], string> = {
  scored: 'scored',
  // i18n: companions.blueprint.legend_measured_nothing
  'measured-zero': 'measured nothing',
  // i18n: companions.blueprint.legend_unknown
  unknown: 'unknown',
  // i18n: companions.blueprint.legend_unmeasurable
  unmeasurable: 'unmeasurable',
};

export interface SignatureProps {
  cells: Record<ChannelId, CellMark>;
  /** The plan's largest single cell: every bar on every row is drawn against it. */
  max: number;
  /** One line per channel, in channel order, for the tip. The caller words them. */
  lines: readonly string[];
  /** The whole mark's accessible name. */
  label: string;
  /** A tenth line under the nine: what the row's TOTAL is, when it is only a floor. */
  foot?: string;
}

/** The nine slots, with no tip: the drawing on its own, for the legend. */
export function SignatureSlots({ cells, max }: { cells: Record<ChannelId, CellMark>; max: number }) {
  return (
    <>
      {CHANNELS.map((spec) => {
        const cell = cells[spec.id];
        const style = cell.kind === 'scored'
          ? ({ '--bpa-h': `${String(bandHeight(cell.mark.points, max))}px` } as CSSProperties)
          : undefined;
        return <span key={spec.id} className={SLOT_CLASS[cell.kind]} style={style} />;
      })}
    </>
  );
}

export function Signature({ cells, max, lines, label, foot }: SignatureProps) {
  const tip = (
    <span className="bpa-tip">
      {CHANNELS.map((spec, i) => (
        <span key={spec.id} className="contents">
          <span className="typo-data bpa-tip__n">{spec.id}</span>
          <span className="typo-label">{spec.glyph}</span>
          <span className="typo-caption">{lines[i]}</span>
        </span>
      ))}
      {foot != null && <span className="typo-caption bpa-tip__foot">{foot}</span>}
    </span>
  );
  return (
    <Tooltip content={tip} placement="left">
      <span className="bpa-sig" role="img" aria-label={label} tabIndex={0}>
        <SignatureSlots cells={cells} max={max} />
      </span>
    </Tooltip>
  );
}

/**
 * The ruler: the nine channel numbers on the signature's own grid, so the
 * column head IS the legend and position resolves to a reason without a hover.
 */
export function SignatureRuler({ names, weights }: { names: readonly string[]; weights: readonly string[] }) {
  return (
    <span className="bpa-ruler">
      {CHANNELS.map((spec, i) => (
        <Tooltip key={spec.id} content={`${spec.glyph}  ${names[i] ?? ''} - ${weights[i] ?? ''}`} placement="top">
          <span className="bpa-ruler__n typo-label">{spec.id}</span>
        </Tooltip>
      ))}
    </span>
  );
}
