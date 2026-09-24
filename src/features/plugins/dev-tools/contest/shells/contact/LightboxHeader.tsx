// The lightbox's permanent chrome: back to the table, the roll's edge print,
// and its family — the roll it refines and the rounds that refine it, each
// one click away. Renders from the list summary, so it paints before the
// roll's detail arrives.
import { ArrowLeft, GitBranch } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { focusContest } from '../../focus';
import { CONTACT_COPY as C, fill } from './copy';
import { StripHeader } from './StripHeader';

export interface LightboxHeaderProps {
  summary: ContestSummary;
  /** Refine rounds of this roll, from the list. */
  rounds: ContestSummary[];
  onBack: () => void;
}

export function LightboxHeader({ summary, rounds, onBack }: LightboxHeaderProps) {
  const parentId = summary.parentId;
  return (
    <div className="space-y-2 border-b border-primary/10 pb-3" data-testid="contact-lightbox-header">
      <Button
        size="sm"
        variant="ghost"
        icon={<ArrowLeft className="w-3.5 h-3.5" />}
        onClick={onBack}
        data-testid="contact-lightbox-back"
      >
        {C.back}
      </Button>
      <StripHeader summary={summary} />
      {(parentId || rounds.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-foreground" aria-hidden />
          {parentId && (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => focusContest({ projectId: summary.projectId, contestId: parentId })}
            >
              {fill(C.stripRefines, { parent: parentId })}
            </Button>
          )}
          {rounds.map((c) => (
            <Button
              key={c.contestId}
              size="xs"
              variant="secondary"
              onClick={() => focusContest({ projectId: c.projectId, contestId: c.contestId })}
            >
              {fill(C.stripRound, { n: c.round ?? '?' })} · {c.title}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
