// The edge print of a contact strip: title, project, phase, when, round, and
// — once decided — the kept frame with the seat that made it.
// Extractable: a one-line contest identity for any gallery surface.
import { Star } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { phaseLabel, phaseTone } from '../../model/labels';
import { CONTACT_COPY as C, fill } from './copy';
import { SpecChips } from './SpecChips';

export interface StripHeaderProps {
  summary: ContestSummary;
  /** Omit to render the title as a heading (inside the lightbox). */
  onOpen?: () => void;
  /** Trailing controls (the develop toggle). */
  actions?: ReactNode;
}

export function StripHeader({ summary, onOpen, actions }: StripHeaderProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {onOpen ? (
        <Button
          variant="link"
          size="sm"
          onClick={onOpen}
          aria-label={fill(C.stripOpen, { title: summary.title })}
          className="min-w-0"
          data-testid={`contact-strip-open-${summary.contestId}`}
        >
          <span className="typo-title-lg truncate">{summary.title}</span>
        </Button>
      ) : (
        <h2 className="typo-heading-lg min-w-0 truncate">{summary.title}</h2>
      )}
      <StatusBadge variant={phaseTone(summary.phase)} size="sm" pill>
        {phaseLabel(s, summary.phase)}
      </StatusBadge>
      <span className="typo-caption text-foreground">{summary.projectName}</span>
      {summary.round !== null && (
        <span className="typo-caption text-foreground">{fill(C.stripRound, { n: summary.round })}</span>
      )}
      {summary.parentId && (
        <span className="typo-caption text-foreground">{fill(C.stripRefines, { parent: summary.parentId })}</span>
      )}
      <span className="typo-caption text-foreground">
        {fill(C.stripSeats, { count: summary.seatCount })} ·{' '}
        {fill(C.stripFrames, { count: summary.seatCount * summary.variantsPerSeat })}
      </span>
      <RelativeTime timestamp={summary.updatedAtMs} className="typo-caption text-foreground" />
      {summary.winner && (
        <span className="inline-flex flex-wrap items-center gap-1.5" data-testid={`contact-strip-kept-${summary.contestId}`}>
          <Star className="w-3.5 h-3.5 text-status-success" aria-hidden />
          <span className="typo-title">{fill(C.stripKept, { key: summary.winner })}</span>
          {summary.winnerSeatSpec && <SpecChips spec={summary.winnerSeatSpec} />}
        </span>
      )}
      {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}
