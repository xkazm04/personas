// PROTOTYPE ROUND (spark council-readout). What each member pointed at: the
// `file:line` (or command, or url) as a monospaced reference, the caption
// beside it as body text, and the registry techniques the member checked.
import { useState } from 'react';

import Button from '@/features/shared/components/buttons/Button';

import type { Seat } from '../../../table/runModel';
import { memberName } from './format';
import { fill, S } from './strings';

/** Enough to see what kind of proof a member leans on, without a wall. */
const FIRST = 5;

function MemberEvidence({ seat }: { seat: Seat }) {
  const [all, setAll] = useState(false);
  const shown = all ? seat.evidence : seat.evidence.slice(0, FIRST);
  const rest = seat.evidence.length - FIRST;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 flex items-baseline gap-3 typo-heading text-foreground">
        {memberName(seat.name)}
        <span className="typo-data text-muted">{seat.evidence.length}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {shown.map((e, i) => (
          <li key={`${e.ref}-${i}`} className="flex flex-col gap-1">
            <code className="dz-ref self-start typo-code text-foreground">{e.ref}</code>
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
        <div className="flex flex-col gap-2">
          <span className="typo-label text-muted">{S.techniques}</span>
          <div className="flex flex-wrap gap-2">
            {seat.techniques.map((tq, i) => (
              <span
                key={`${tq.subject}-${tq.technique}-${i}`}
                className="inline-flex items-center gap-2 rounded-pill border border-primary/25 bg-primary/[0.06] px-3 py-0.5 typo-body text-foreground"
              >
                <span className="text-primary">{tq.subject}</span>
                <span>{tq.technique}</span>
                <span className="typo-label text-muted">{S.proof[tq.proof] ?? tq.proof}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EvidenceSection({ seats }: { seats: Seat[] }) {
  const withEvidence = seats.filter((s) => s.evidence.length || s.techniques.length);
  return (
    <div className="flex flex-col gap-8">
      {withEvidence.map((seat) => (
        <MemberEvidence key={seat.name} seat={seat} />
      ))}
    </div>
  );
}
