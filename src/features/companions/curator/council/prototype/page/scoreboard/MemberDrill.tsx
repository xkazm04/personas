// PROTOTYPE ROUND (spark council-readout). A member, drilled: its findings
// fill the page (title strong, detail as body text), its evidence sits beside
// them as monospaced references with their captions.
import { useState } from 'react';

import Button from '@/features/shared/components/buttons/Button';

import type { Finding, Seat } from '../../../table/runModel';
import { bySeverity, memberName } from './format';
import { fill, S } from './strings';

const SEVERITY_TEXT: Record<Finding['severity'], string> = {
  high: 'text-status-error',
  med: 'text-status-warning',
  low: 'text-muted',
};
const CLAMP_FROM = 420;
const FIRST_EVIDENCE = 8;

function FindingBlock({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const long = finding.detail.length > CLAMP_FROM;
  return (
    <li className={`sb-finding is-${finding.severity} flex flex-col gap-1.5`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className={`typo-label ${SEVERITY_TEXT[finding.severity]}`}>{S.severity[finding.severity]}</span>
        {finding.recurrence > 1 ? <span className="typo-label text-muted">{fill(S.seen, { count: finding.recurrence })}</span> : null}
      </div>
      <h3 className="m-0 typo-title-lg text-foreground">{finding.title}</h3>
      {finding.detail ? <p className={`m-0 typo-body text-foreground ${long && !open ? 'sb-clamp' : ''}`}>{finding.detail}</p> : null}
      {long ? (
        <Button variant="link" size="sm" className="self-start !px-0" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="typo-body">{open ? S.readLess : S.readMore}</span>
        </Button>
      ) : null}
    </li>
  );
}

function EvidenceAside({ seat }: { seat: Seat }) {
  const [all, setAll] = useState(false);
  const rest = seat.evidence.length - FIRST_EVIDENCE;
  const shown = all ? seat.evidence : seat.evidence.slice(0, FIRST_EVIDENCE);
  return (
    <aside className="sb-drill__aside flex flex-col gap-3" aria-labelledby="sb-evidence-h">
      <h2 id="sb-evidence-h" className="m-0 flex items-baseline gap-3 typo-section-title">
        {S.evidence}
        <span className="typo-data text-muted">{seat.evidence.length}</span>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {shown.map((e, i) => (
          <li key={`${e.ref}-${i}`} className="flex flex-col gap-1">
            <code className="sb-ref self-start typo-code text-foreground">{e.ref}</code>
            {e.caption ? <span className="typo-body text-foreground">{e.caption}</span> : null}
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <Button variant="link" size="sm" className="self-start !px-0" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          <span className="typo-body">{all ? S.lessEvidence : fill(S.moreEvidence, { count: rest })}</span>
        </Button>
      ) : null}
      {seat.techniques.length ? (
        <div className="flex flex-col gap-2 pt-2">
          <span className="typo-label text-muted">{S.techniques}</span>
          <div className="flex flex-wrap gap-2">
            {seat.techniques.map((tq, i) => (
              <span
                key={`${tq.subject}-${tq.technique}-${i}`}
                className="inline-flex flex-wrap items-center gap-x-2 rounded-pill border border-primary/25 bg-primary/[0.06] px-3 py-0.5 typo-body text-foreground"
              >
                <span className="text-primary">{tq.subject}</span>
                <span>{tq.technique}</span>
                <span className="typo-label text-muted">{S.proof[tq.proof] ?? tq.proof}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function MemberDrill({ seat, reason }: { seat: Seat; reason: string | null }) {
  return (
    <div className="sb-drill">
      <div className="flex min-w-0 flex-col gap-4">
        {/* The band may be scrolled away, so the drill names whose findings these are. */}
        <h2 className="m-0 flex items-baseline gap-3 typo-section-title">
          {memberName(seat.name)}
          <span className="typo-heading text-muted">{fill(S.findingsCount, { count: seat.findings.length })}</span>
        </h2>
        {seat.score == null ? (
          <p className="m-0 rounded-card border border-dashed border-border px-4 py-3 typo-body-lg text-foreground">
            <strong className="font-semibold">{seat.state === 'not_run' ? S.notRun : `${S.notMeasured}.`}</strong> {reason ?? ''}
          </p>
        ) : null}
        {seat.findings.length ? (
          <ul className="m-0 flex list-none flex-col gap-7 p-0">
            {bySeverity(seat.findings).map((f) => (
              <FindingBlock key={f.id} finding={f} />
            ))}
          </ul>
        ) : (
          <p className="m-0 typo-body-lg text-muted">{S.noFindings}</p>
        )}
      </div>
      <EvidenceAside seat={seat} />
    </div>
  );
}
