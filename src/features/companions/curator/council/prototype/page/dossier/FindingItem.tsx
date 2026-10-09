// PROTOTYPE ROUND (spark council-readout). One finding: severity as a coloured
// edge AND a word (never colour alone), the title strong, the detail as body
// text clamped to three lines until the reader asks for the rest.
import { useState } from 'react';

import Button from '@/features/shared/components/buttons/Button';

import type { Finding } from '../../../table/runModel';
import { fill, S } from './strings';

const SEVERITY_TEXT: Record<Finding['severity'], string> = {
  high: 'text-status-error',
  med: 'text-status-warning',
  low: 'text-muted',
};

/** A detail shorter than this reads whole; clamping it would only add a control. */
const CLAMP_FROM = 320;

export function FindingItem({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  // A low finding reads as its title until asked: the dossier stays a page
  // you can scan, and nothing is hidden that one press does not bring back.
  const folded = finding.severity === 'low' && finding.detail.length > 0;
  const long = folded || finding.detail.length > CLAMP_FROM;
  return (
    <li className={`dz-finding is-${finding.severity} flex flex-col gap-1.5`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className={`typo-label ${SEVERITY_TEXT[finding.severity]}`}>{S.severity[finding.severity]}</span>
        {finding.recurrence > 1 ? (
          <span className="typo-label text-muted">{fill(S.seen, { count: finding.recurrence })}</span>
        ) : null}
      </div>
      <h4 className="m-0 typo-title-lg text-foreground">{finding.title}</h4>
      {finding.detail && !(folded && !open) ? (
        <p className={`m-0 typo-body text-foreground ${long && !open ? 'dz-clamp' : ''}`}>{finding.detail}</p>
      ) : null}
      {long ? (
        <Button variant="link" size="sm" className="self-start !px-0" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="typo-body">{open ? S.readLess : S.readMore}</span>
        </Button>
      ) : null}
    </li>
  );
}
