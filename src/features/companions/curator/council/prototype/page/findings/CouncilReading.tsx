// PROTOTYPE ROUND (spark council-readout, direction G). The council's own
// summary, folded. Closed, it is the lede at reading size. Opened, the same
// words broken where the prose already changes subject: the lede, then one
// short paragraph per member under that member's mark, in two columns on a
// wide window - never one 2,000-character wall.
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Collapse } from '@/features/shared/components/display/Collapse';
import type { CouncilRun } from '@/lib/bindings/CouncilRun';

import { splitReading } from './boardModel';
import { MemberIcon, useMemberName } from './marks';

const S = {
  heading: "Council's reading",
  open: 'Read it all',
  close: 'Fold it',
  fallback: "The council wrote no summary for this round. This is the feature's own description.",
  scope: (n: number, sha: string) => `Judged ${n} files at ${sha}`,
  copyDir: 'Copy the run folder',
};

export function CouncilReading({ run, spanned }: { run: CouncilRun; spanned: number }) {
  const [open, setOpen] = useState(false);
  const name = useMemberName();
  const reading = useMemo(() => splitReading(run.summary), [run.summary]);
  const lede = reading.lede || run.summary;
  return (
    <section
      aria-label={S.heading}
      className="flex flex-col gap-4 rounded-card border border-primary/15 bg-primary/[0.04] px-6 py-5"
      data-testid="findings-reading"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="m-0 typo-section-title text-foreground">{S.heading}</h3>
        <Button
          variant="ghost"
          size="md"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          iconRight={
            <ChevronDown
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            />
          }
        >
          {open ? S.close : S.open}
        </Button>
      </div>
      {run.summaryIsSubjectFallback ? <p className="m-0 typo-body text-status-warning">{S.fallback}</p> : null}
      <p className={`m-0 max-w-[110ch] typo-body-lg text-foreground ${open ? '' : 'line-clamp-2'}`}>{lede}</p>
      <Collapse open={open} unmountWhenClosed>
        <div className="flex flex-col gap-5">
          {reading.parts.length > 0 ? (
            <div className="gap-10 lg:columns-2">
              {reading.parts.map((part, i) => (
                <div key={`${part.member}-${i}`} className="mb-5 flex break-inside-avoid flex-col gap-1.5">
                  <span className="inline-flex items-center gap-2 typo-heading capitalize text-primary">
                    <MemberIcon name={part.member} className="h-[18px] w-[18px]" />
                    {name(part.member)}
                  </span>
                  <p className="m-0 typo-body-lg text-foreground">{part.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <span className="typo-body text-muted">{S.scope(spanned, run.headSha.slice(0, 9))}</span>
            <span className="min-w-0 truncate typo-code text-muted">{run.runDir}</span>
            <CopyButton text={run.runDir} tooltip={S.copyDir} />
          </div>
        </div>
      </Collapse>
    </section>
  );
}
