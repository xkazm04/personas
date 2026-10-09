// PROTOTYPE ROUND (spark council-readout), direction C. The council's
// members as a row of dots on a fixed pitch, one column per member so every
// row lines up under the head's initials: fill = score on the ramp, a hollow
// dashed ring = not measured (never a zero), an outer red ring = floor hit.
// While the round is still being read the slots are ghosts.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { Seat } from '../../../table/runModel';
import { rampStep } from './tableModel';

const S = {
  notMeasured: 'not measured',
  notApplicable: 'not applicable',
  notInRubric: 'not in this rubric',
  floorHit: 'below its floor',
  reading: 'Reading the members',
};

/** Two letters per member: the head's initials over the dot columns. */
export const MEMBER_INITIALS: Record<string, string> = {
  value: 'Va',
  craft: 'Cr',
  rivalry: 'Ri',
  robustness: 'Ro',
  economics: 'Ec',
  reversibility: 'Re',
};

export function memberName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function seatClass(seat: Seat | undefined): string {
  if (!seat) return 'bt-dot is-none';
  if (seat.state === 'not_applicable') return 'bt-dot is-na';
  if (seat.score == null) return 'bt-dot is-unmeasured';
  return `bt-dot r${rampStep(seat.score)}${seat.floorHit ? ' is-floor' : ''}`;
}

export function MemberDots({ seats, columns }: { seats: Seat[] | null; columns: string[] }) {
  const { language } = useTranslation();
  if (!seats) {
    return (
      <span className="bt-dots" role="img" aria-label={S.reading}>
        {columns.map((c) => (
          <i key={c} className="bt-dot is-ghost" aria-hidden="true" />
        ))}
      </span>
    );
  }
  const line = (c: string) => {
    const seat = seats.find((s) => s.name === c);
    if (!seat) return `${memberName(c)}: ${S.notInRubric}`;
    if (seat.state === 'not_applicable') return `${memberName(c)}: ${S.notApplicable}`;
    if (seat.score == null) return `${memberName(c)}: ${S.notMeasured}`;
    const score = formatCount(seat.score, { precision: 2, language });
    return `${memberName(c)} ${score}${seat.floorHit ? `, ${S.floorHit}` : ''}`;
  };
  const lines = columns.map(line);
  return (
    <Tooltip
      placement="left"
      content={
        <span className="flex flex-col gap-0.5 typo-body">
          {lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </span>
      }
    >
      <span className="bt-dots" role="img" aria-label={lines.join('; ')}>
        {columns.map((c) => (
          <i key={c} className={seatClass(seats.find((s) => s.name === c))} aria-hidden="true" />
        ))}
      </span>
    </Tooltip>
  );
}

/** The head over the dot columns: each member's initials on the same pitch. */
export function MemberHead({ columns }: { columns: string[] }) {
  return (
    <span className="bt-dots bt-dots--head typo-body" aria-label={columns.map(memberName).join(', ')}>
      {columns.map((c) => (
        <b key={c} className="bt-dothead" aria-hidden="true">
          {MEMBER_INITIALS[c] ?? memberName(c).slice(0, 2)}
        </b>
      ))}
    </span>
  );
}

export default MemberDots;
