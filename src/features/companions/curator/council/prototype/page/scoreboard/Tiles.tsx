// PROTOTYPE ROUND (spark council-readout). The faces of the band's columns:
// the anchor (overall + coverage) and one per member (score, water level,
// confidence, findings as one square each, kind and weight).
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';

import type { Finding, Seat } from '../../../table/runModel';
import { usePercent } from '../../../table/usePercent';
import { memberName, useScore } from './format';
import { Level } from './Level';
import { fill, S } from './strings';

const SEVERITIES: Finding['severity'][] = ['high', 'med', 'low'];
const PIPS: Record<string, number> = { low: 1, med: 2, high: 3 };
const SEVERITY_TEXT: Record<Finding['severity'], string> = {
  high: 'text-status-error',
  med: 'text-status-warning',
  low: 'text-foreground',
};

export function AnchorFace({ detail, threshold, coverageFloor }: { detail: CouncilRunDetail; threshold: number; coverageFloor: number }) {
  const score = useScore();
  const percent = usePercent();
  const { overall, coverage } = detail.run;
  const below = overall != null && overall < threshold;
  return (
    <>
      <span className="typo-heading-lg text-primary">{S.overall}</span>
      <span className={`typo-hero leading-none ${overall == null ? 'text-muted' : below ? 'text-foreground' : 'text-status-success'}`}>
        {overall == null ? '–' : score(overall)}
      </span>
      <span className={`truncate typo-heading ${overall == null ? 'text-muted' : below ? 'text-status-warning' : 'text-status-success'}`}>
        {overall == null ? S.noOverall : below ? fill(S.short, { gap: score(threshold - overall) }) : fill(S.clears, { gap: score(overall - threshold) })}
      </span>
      <Level value={overall} threshold={threshold} barTag={`${S.bar} ${score(threshold)}`} />
      <div className="mt-1 flex flex-col gap-1.5">
        <div className="relative h-2.5 rounded-pill bg-foreground/[0.08]">
          <i className="absolute inset-y-0 left-0 rounded-pill bg-primary" style={{ width: `${coverage * 100}%` }} />
          <i className="absolute -inset-y-1 w-0 border-l-2 border-status-error" style={{ left: `${coverageFloor * 100}%` }} />
        </div>
        <span className="typo-body text-foreground">{fill(S.measured, { percent: percent(coverage) })}</span>
      </div>
    </>
  );
}

export function MemberFace({ seat }: { seat: Seat }) {
  const score = useScore();
  const percent = usePercent();
  const measured = seat.score != null;
  const pips = PIPS[seat.confidence ?? ''] ?? 0;
  return (
    <>
      <span className="sb-face__name typo-heading-lg text-foreground">{memberName(seat.name)}</span>
      <span className="sb-face__score flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          {measured ? (
            <span className={`typo-data-lg ${seat.floorHit ? 'text-status-error' : 'text-foreground'}`}>{score(seat.score as number)}</span>
          ) : (
            <span className="typo-heading text-muted">{S.notMeasured}</span>
          )}
        </span>
        {measured && seat.confidence ? (
          <span className="flex flex-none items-end gap-1.5">
            <span className="sb-pips" aria-hidden="true">
              {[1, 2, 3].map((p) => (
                <i key={p} className={p <= pips ? 'is-on' : ''} style={{ height: 5 + p * 4 }} />
              ))}
            </span>
            <span className="typo-label text-muted">{S.confidenceShort[seat.confidence] ?? seat.confidence}</span>
          </span>
        ) : null}
      </span>
      <span className="sb-face__meta typo-body text-muted">
        {seat.floorHit ? <span className="text-status-error">{S.floorHit} {'·'} </span> : null}
        {S.kind[seat.kind] ?? seat.kind} {'·'} {fill(S.weight, { percent: percent(seat.weight) })}
      </span>
      <Level value={seat.score} threshold={seat.threshold} floor={seat.floor} advisory={seat.advisory} floorHit={seat.floorHit} />
      <span className="sb-squares mt-1" aria-hidden="true">
        {SEVERITIES.flatMap((sev) => seat.findings.filter((f) => f.severity === sev).map((f) => <i key={f.id} className={`sb-sq-${sev}`} />))}
      </span>
      <span className="flex flex-wrap gap-x-3 typo-label">
        {SEVERITIES.map((sev) => {
          const n = seat.findings.filter((f) => f.severity === sev).length;
          return n ? (
            <span key={sev} className={SEVERITY_TEXT[sev]}>
              {fill(S.severityCount[sev] ?? '', { count: n })}
            </span>
          ) : null;
        })}
      </span>
    </>
  );
}

/** What a column says to a screen reader, since its face is drawn. */
export function memberLabel(seat: Seat, score: (v: number) => string): string {
  const head = `${memberName(seat.name)}, ${seat.score == null ? S.notMeasured : score(seat.score)}`;
  const counts = SEVERITIES.map((sev) => fill(S.severityCount[sev] ?? '', { count: seat.findings.filter((f) => f.severity === sev).length }));
  return `${head}, ${S.confidence[seat.confidence ?? ''] ?? ''}, ${counts.join(', ')}`;
}
