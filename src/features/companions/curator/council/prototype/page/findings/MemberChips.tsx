// PROTOTYPE ROUND (spark council-readout, direction G). The members as the
// board's filter: each chip IS the member's mark - its icon, its word, its
// score as a figure and as a bar against the bar, and what it raised.
// Pressing one narrows the board to that member's findings.
import Button from '@/features/shared/components/buttons/Button';

import type { Seat } from '../../../table/runModel';
import { severityCounts } from './boardModel';
import { MemberIcon, ScoreBar, TONE_TEXT, toneOf, useMemberName, useScore } from './marks';

const S = {
  all: 'All',
  filter: 'Filter the board by member',
  notMeasured: 'Not measured',
  findings: (n: number) => `${n} ${n === 1 ? 'finding' : 'findings'}`,
  high: (n: number) => `${n} high`,
};

const PRESSED = '!border-primary/70 !bg-primary/15 shadow-elevation-1';
const RESTING = '!bg-transparent';

function Counts({ seat }: { seat: Seat }) {
  const high = severityCounts(seat.findings).high;
  return (
    <span className="flex items-baseline gap-2 typo-body">
      {seat.score == null ? (
        <span className="text-muted">{seat.findings.length > 0 ? `${S.notMeasured},` : S.notMeasured}</span>
      ) : null}
      {seat.findings.length > 0 || seat.score != null ? (
        <span className="text-muted">{S.findings(seat.findings.length)}</span>
      ) : null}
      {high > 0 ? <span className="text-status-error">{S.high(high)}</span> : null}
    </span>
  );
}

export function MemberChips({
  seats,
  active,
  onPick,
}: {
  seats: Seat[];
  active: string | null;
  onPick: (member: string | null) => void;
}) {
  const score = useScore();
  const name = useMemberName();
  const total = seats.reduce((n, s) => n + s.findings.length, 0);
  return (
    <div role="group" aria-label={S.filter} className="flex flex-wrap items-stretch gap-2.5">
      <Button
        variant="secondary"
        size="md"
        aria-pressed={active === null}
        onClick={() => onPick(null)}
        className={`!rounded-card !px-3.5 !py-2 ${active === null ? PRESSED : RESTING}`}
        data-testid="findings-chip-all"
      >
        <span className="flex flex-col items-start gap-0.5">
          <span className="typo-heading text-foreground">{S.all}</span>
          <span className="typo-body text-muted">{S.findings(total)}</span>
        </span>
      </Button>
      {seats.map((seat) => {
        const tone = toneOf(seat);
        const on = active === seat.name;
        const none = seat.score == null;
        return (
          <Button
            key={seat.name}
            variant="secondary"
            size="md"
            aria-pressed={on}
            onClick={() => onPick(on ? null : seat.name)}
            className={`!rounded-card !px-3.5 !py-2 ${on ? PRESSED : RESTING} ${none ? '!border-dashed' : ''}`}
            data-testid={`findings-chip-${seat.name}`}
          >
            <span className="flex min-w-[10rem] flex-col items-stretch gap-1.5">
              <span className="flex items-center gap-2">
                <span className={none ? 'text-muted' : 'text-primary'}>
                  <MemberIcon name={seat.name} className="h-[18px] w-[18px]" />
                </span>
                <span className="typo-heading capitalize text-foreground">{name(seat.name)}</span>
                {seat.score != null ? (
                  <span className={`ml-auto pl-2 typo-data tabular-nums ${TONE_TEXT[tone]}`}>{score(seat.score)}</span>
                ) : null}
              </span>
              <ScoreBar
                score={seat.score}
                threshold={seat.threshold}
                floor={seat.floor}
                floorHit={seat.floorHit}
                height="h-1.5"
              />
              <Counts seat={seat} />
            </span>
          </Button>
        );
      })}
    </div>
  );
}
