// One member's reading: the score, the rail that puts it against its
// threshold and its floor, what kind of member it is and how much it weighs,
// the one weakness worth reading, and then the evidence well.
//
// The big number is the only large figure on this half of the screen, and a
// member with nothing measured gets NOT MEASURED in its place plus the one
// sentence that says what that means, rather than a blank.
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import { EvidenceWell } from './EvidenceWell';
import type { Finding, Seat } from './runModel';
import { MemberRail, RailLegend } from './svg/MemberRail';
import { ProofGlyph } from './svg/ProofGlyph';
import { ConfidenceBars, RecurrenceDots } from './svg/Dots';
import { usePercent } from './usePercent';

const SEV_BORDER: Record<string, string> = {
  high: 'border-status-error',
  med: 'border-status-warning',
  low: 'border-muted-dark',
};

export function MemberReading({
  seat,
  detail,
  weakest,
}: {
  seat: Seat;
  detail: CouncilRunDetail | null;
  weakest: { seat: Seat; finding: Finding } | null;
}) {
  const { t, tx } = useTranslation();
  const tbl = t.council.table;
  const percent = usePercent();
  const isWeakest = weakest?.seat.name === seat.name;
  const stateWord =
    seat.state === 'carried'
      ? tbl.state_carried
      : seat.state === 'not_applicable'
        ? tbl.state_not_applicable
        : seat.state === 'not_run'
          ? tbl.state_not_run
          : tbl.state_unmeasured;

  return (
    <div className="flex flex-col gap-5" data-testid="council-member-reading">
      <h2 className="m-0 flex flex-wrap items-baseline gap-4 typo-page-title capitalize text-foreground">
        {seat.name}
        {seat.score == null ? (
          <em className="not-italic typo-heading uppercase tracking-wide text-muted-dark">
            {tbl.not_measured_caps}
          </em>
        ) : (
          <em className="not-italic text-[42px] font-bold leading-none tabular-nums tracking-tight">
            <Numeric value={seat.score} precision={2} />
          </em>
        )}
      </h2>

      <MemberRail
        seat={seat}
        ariaLabel={tx(tbl.rail_label, {
          member: seat.name,
          reading: seat.score == null ? stateWord : seat.score.toFixed(2),
        })}
      />
      <RailLegend
        labels={{
          threshold: tbl.rail_threshold,
          bindingFloor: tbl.rail_binding_floor,
          advisoryFloor: tbl.rail_advisory_floor,
          carried: tbl.rail_carried,
          notMeasured: tbl.rail_not_measured,
        }}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 typo-body text-muted">
        <span>
          {seat.kind === 'mechanical'
            ? tbl.kind_mechanical
            : seat.kind === 'judged'
              ? tbl.kind_judged
              : tbl.kind_mixed}
        </span>
        <span className="inline-flex items-center gap-2">
          <i aria-hidden="true" className="relative block h-[7px] w-[46px] overflow-hidden rounded bg-border">
            <i className="absolute inset-y-0 left-0 bg-muted-foreground" style={{ width: percent(seat.weight) }} />
          </i>
          {tx(tbl.weight_line, { percent: percent(seat.weight) })}
        </span>
        <ConfidenceBars
          confidence={seat.confidence}
          text={
            seat.confidence === 'high'
              ? tbl.confidence_high
              : seat.confidence === 'med'
                ? tbl.confidence_med
                : tbl.confidence_low
          }
        />
        <span>
          {seat.floor == null
            ? tbl.no_floor
            : seat.advisory
              ? tx(tbl.floor_advisory, { floor: seat.floor.toFixed(2) })
              : tx(tbl.floor_binding, { floor: seat.floor.toFixed(2) })}
        </span>
        {seat.delta ? (
          <span className="typo-heading text-status-success">
            {tx(tbl.delta_since, { delta: seat.delta })}
          </span>
        ) : seat.state === 'carried' ? (
          <span className="typo-body text-muted">{tbl.delta_carried}</span>
        ) : null}
      </div>

      {seat.score == null ? (
        <p className="m-0 max-w-[66ch] typo-body text-foreground">
          {stateWord}. {tbl.not_measured_prose}
        </p>
      ) : null}

      {seat.findings.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h3 className="m-0 typo-caption uppercase tracking-widest text-muted">
            {isWeakest ? tbl.weakness_heading : tbl.findings_heading}
          </h3>
          {seat.findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              member={seat.name}
              highlighted={weakest?.finding.id === f.id && isWeakest}
            />
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="m-0 typo-caption uppercase tracking-widest text-muted">{tbl.evidence_heading}</h3>
        <EvidenceWell seat={seat} runId={detail?.run.id ?? null} />
      </section>

      {seat.techniques.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 typo-caption uppercase tracking-widest text-muted">{tbl.techniques_heading}</h3>
          {seat.techniques.map((tq) => {
            const proofWord =
              tq.proof === 'execution'
                ? tbl.proof_execution
                : tq.proof === 'inspection'
                  ? tbl.proof_inspection
                  : tbl.proof_claim;
            return (
              <div key={`${tq.subject}/${tq.technique}`} className="flex items-center gap-2.5">
                <ProofGlyph proof={tq.proof} label={proofWord} />
                <span className="min-w-0">
                  <b className="block typo-title text-foreground">{tq.technique}</b>
                  <small className="typo-caption text-muted-dark">
                    {tx(tbl.technique_sub, { subject: tq.subject, proof: proofWord })}
                  </small>
                </span>
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function FindingCard({
  finding,
  member,
  highlighted,
}: {
  finding: Finding;
  member: string;
  highlighted: boolean;
}) {
  const { t, tx } = useTranslation();
  const tbl = t.council.table;
  const severityWord =
    finding.severity === 'high'
      ? tbl.severity_high
      : finding.severity === 'med'
        ? tbl.severity_med
        : tbl.severity_low;
  const body = (
    <article className={`border-l-4 py-0.5 pl-4 ${SEV_BORDER[finding.severity] ?? SEV_BORDER.low}`}>
      <header className="flex flex-wrap items-baseline gap-3">
        <span
          className={`typo-heading uppercase tracking-widest ${
            finding.severity === 'high'
              ? 'text-status-error'
              : finding.severity === 'med'
                ? 'text-status-warning'
                : 'text-muted'
          }`}
        >
          {severityWord}
        </span>
        <h4 className="m-0 typo-title text-foreground">{finding.title}</h4>
      </header>
      <p className="my-2 max-w-[68ch] typo-body text-foreground">{finding.detail}</p>
      <footer className="flex flex-wrap items-center gap-4 typo-caption text-muted-dark">
        <span>{tx(tbl.raised_by, { member })}</span>
        <RecurrenceDots
          recurrence={finding.recurrence}
          text={
            finding.recurrence === 0
              ? tbl.recurrence_first
              : finding.recurrence === 1
                ? tbl.recurrence_seen_one
                : tx(tbl.recurrence_seen, { count: finding.recurrence })
          }
        />
      </footer>
    </article>
  );
  if (!highlighted) return body;
  return (
    <div className="rounded-card border border-status-warning/40 bg-status-warning/[0.09] px-5 py-4">
      {body}
    </div>
  );
}

export default MemberReading;
