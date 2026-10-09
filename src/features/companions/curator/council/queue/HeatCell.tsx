// One heat cell: the colour is the score on the sequential ramp (and the
// score is printed in it, so the colour never has to be decoded alone); a
// hatched cell is a member nobody measured - never a zero; a red corner is a
// floor hit.
import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { rampStep, type LaneMark } from './laneModel';

export type CellKind = 'score' | 'unmeasured' | 'na' | 'absent' | 'ghost';

export function cellKind(mark: LaneMark | undefined): CellKind {
  if (!mark) return 'absent';
  if (mark.state === 'not_applicable') return 'na';
  return mark.score == null ? 'unmeasured' : 'score';
}

export function HeatCell({
  kind,
  score,
  floorHit = false,
  lane = false,
}: {
  kind: CellKind;
  score: number | null;
  floorHit?: boolean;
  /** The lane's mean strip: a slimmer cell. */
  lane?: boolean;
}) {
  const { language } = useTranslation();
  const base = `ln-cell${lane ? ' ln-cell--lane' : ''}`;
  if (kind === 'ghost') return <span className={`${base} is-ghost`} aria-hidden="true" />;
  if (kind === 'absent') return <span className={`${base} is-absent`} aria-hidden="true" />;
  if (kind === 'na') return <span className={`${base} is-na`} aria-hidden="true" />;
  if (kind === 'unmeasured' || score == null) return <span className={`${base} is-hatch`} aria-hidden="true" />;
  return (
    <span className={`${base} r${rampStep(score)}${floorHit ? ' is-floor' : ''}`} aria-hidden="true">
      <span className="ln-cell__n typo-data">{formatCount(score, { precision: 2, language })}</span>
    </span>
  );
}

export default HeatCell;
