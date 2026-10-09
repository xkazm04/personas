// PROTOTYPE ROUND (spark council-readout, direction G). One finding as the
// board reads it: severity as a coloured word, the title strong, the detail
// as body text (clamped, opened on request), and its evidence as monospaced
// refs whose caption is one hover away.
import { useState, type ReactNode } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import type { EvidenceItem, Finding } from '../../../table/runModel';

const S = {
  severity: { high: 'High', med: 'Medium', low: 'Low' } as Record<Finding['severity'], string>,
  more: 'Read all of it',
  less: 'Show less',
  evidence: 'Evidence',
  moreRefs: (n: number) => `+${n} more`,
};

export const SEVERITY_TEXT: Record<Finding['severity'], string> = {
  high: 'text-status-error',
  med: 'text-status-warning',
  low: 'text-muted',
};

export const SEVERITY_RULE: Record<Finding['severity'], string> = {
  high: 'bg-status-error',
  med: 'bg-status-warning',
  low: 'bg-muted-dark',
};

export function SeverityWord({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className={`inline-flex items-center gap-2 typo-label ${SEVERITY_TEXT[severity]}`}>
      <i aria-hidden="true" className={`h-2 w-2 rounded-full ${SEVERITY_RULE[severity]}`} />
      {S.severity[severity]}
    </span>
  );
}

/** "app/_lib/pipeline-entry-action.ts:508-529" -> "pipeline-entry-action.ts:508-529"; a command stays whole. */
function shortRef(ref: string): string {
  if (/\s/.test(ref)) return ref;
  return ref.split(/[\\/]/).pop() || ref;
}

export function EvidenceRefs({ items, cap = 4 }: { items: EvidenceItem[]; cap?: number }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, cap);
  return (
    <ul aria-label={S.evidence} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {shown.map((e) => (
        <li key={`${e.kind}-${e.ref}`}>
          <Tooltip
            content={
              <span className="flex flex-col gap-1">
                <span className="typo-code">{e.ref}</span>
                {e.caption ? <span className="typo-body">{e.caption}</span> : null}
              </span>
            }
            placement="top"
          >
            <span
              tabIndex={0}
              aria-label={`${e.ref}${e.caption ? `: ${e.caption}` : ''}`}
              className="inline-flex max-w-[24rem] items-center truncate rounded-interactive border border-primary/20 bg-primary/5 px-2.5 py-1 typo-code text-foreground focus-ring"
            >
              {shortRef(e.ref)}
            </span>
          </Tooltip>
        </li>
      ))}
      {items.length > cap ? (
        <li className="self-center typo-body text-muted">{S.moreRefs(items.length - cap)}</li>
      ) : null}
    </ul>
  );
}

/** The finding's prose, clamped to a few lines until the reader asks for all of it. */
export function FindingDetail({ detail, lines = 3 }: { detail: string; lines?: 3 | 4 }) {
  const [open, setOpen] = useState(false);
  const long = detail.length > 260;
  return (
    <div className="flex flex-col items-start gap-1">
      <p
        className={`m-0 whitespace-pre-line typo-body text-foreground ${
          !open && long ? (lines === 3 ? 'line-clamp-3' : 'line-clamp-4') : ''
        }`}
      >
        {detail}
      </p>
      {long ? (
        <Button variant="link" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? S.less : S.more}
        </Button>
      ) : null}
    </div>
  );
}

export function FindingItem({
  finding,
  evidence,
  member,
}: {
  finding: Finding;
  evidence: EvidenceItem[];
  /** The member's mark, when the list mixes members. */
  member?: ReactNode;
}) {
  return (
    <article className="relative flex flex-col gap-2.5 rounded-card border border-card-border bg-card-bg py-4 pl-6 pr-5">
      <i
        aria-hidden="true"
        className={`absolute inset-y-4 left-0 w-1 rounded-pill ${SEVERITY_RULE[finding.severity]}`}
      />
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {member}
        <SeverityWord severity={finding.severity} />
      </span>
      <h4 className="m-0 typo-title-lg text-foreground">{finding.title}</h4>
      <FindingDetail detail={finding.detail} />
      <EvidenceRefs items={evidence} />
    </article>
  );
}
