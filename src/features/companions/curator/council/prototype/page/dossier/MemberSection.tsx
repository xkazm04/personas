// PROTOTYPE ROUND (spark council-readout). One member, as a chapter: its
// score drawn against its floor and the bar, the facts that qualify it in
// one line, then its findings severest first.
import type { Seat } from '../../../table/runModel';
import { usePercent } from '../../../table/usePercent';
import { bySeverity, memberName, sectionId, useScore } from './format';
import { FindingItem } from './FindingItem';
import { fill, S } from './strings';
import { Track } from './Track';

function Fact({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center rounded-pill border border-border px-3 py-0.5 typo-body ${tone ?? 'text-foreground'}`}>
      {children}
    </span>
  );
}

export function MemberSection({ seat, reason }: { seat: Seat; reason: string | null }) {
  const score = useScore();
  const percent = usePercent();
  const name = memberName(seat.name);
  const measured = seat.score != null;
  const stateWord =
    seat.state === 'not_applicable' ? S.notApplicable : seat.state === 'not_run' ? S.notRun : S.notMeasured;
  return (
    <section id={sectionId(`member-${seat.name}`)} aria-labelledby={`${sectionId(seat.name)}-h`} className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-6">
        <h3 id={`${sectionId(seat.name)}-h`} className="m-0 typo-heading-lg text-foreground">
          {name}
        </h3>
        <span className={`dz-bigscore typo-data-lg ${measured ? (seat.floorHit ? 'text-status-error' : 'text-foreground') : 'text-muted'}`}>
          {measured ? score(seat.score as number) : S.notMeasured}
        </span>
      </div>
      <Track
        size="md"
        value={seat.score}
        threshold={seat.threshold}
        floor={seat.floor}
        advisory={seat.advisory}
        floorHit={seat.floorHit}
        label={`${name} ${measured ? score(seat.score as number) : S.notMeasured}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Fact>{S.kind[seat.kind] ?? seat.kind}</Fact>
        <Fact>{fill(S.weight, { percent: percent(seat.weight) })}</Fact>
        {seat.confidence ? <Fact>{fill(S.confidence, { level: S.level[seat.confidence] ?? seat.confidence })}</Fact> : null}
        {seat.floor != null ? (
          <Fact tone={seat.floorHit ? 'text-status-error' : undefined}>
            {seat.floorHit ? S.floorHit : fill(seat.advisory ? S.advisoryFloor : S.floor, { floor: score(seat.floor) })}
          </Fact>
        ) : null}
        {seat.state === 'carried' ? <Fact tone="text-primary">{S.carried}</Fact> : null}
      </div>
      {!measured ? (
        <p className="m-0 rounded-card border border-dashed border-border px-4 py-3 typo-body-lg text-foreground">
          <strong className="font-semibold">{stateWord}.</strong> {reason ?? ''}
        </p>
      ) : null}
      {seat.findings.length ? (
        <ul className="m-0 flex list-none flex-col gap-6 p-0 pt-2">
          {bySeverity(seat.findings).map((f) => (
            <FindingItem key={f.id} finding={f} />
          ))}
        </ul>
      ) : measured ? (
        <p className="m-0 typo-body text-muted">{S.noFindings}</p>
      ) : null}
    </section>
  );
}
