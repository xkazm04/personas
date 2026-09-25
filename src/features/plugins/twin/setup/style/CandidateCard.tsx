/**
 * One rolled candidate. Visibly NOT a preset: a "Rolled" badge, a dashed
 * primary border and its own number, so a generated style can never pass for
 * a curated one.
 */

import { Dices } from 'lucide-react';
import { Badge } from '@/features/shared/components/display/Badge';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { DimensionChips } from './DimensionChips';
import { StyleSample } from './StyleSample';
import type { StyleCandidate, StyleDimension, TwinStylePins } from './styleContract';

interface CandidateCardProps {
  candidate: StyleCandidate;
  /** 1-based position, for the test ids. */
  n: number;
  pins: TwinStylePins;
  onTogglePin: (dim: StyleDimension, value: number) => void;
  onUse: (id: string) => void;
}

export function CandidateCard({ candidate, n, pins, onTogglePin, onUse }: CandidateCardProps) {
  const { t } = useTranslation();
  const ts = t.twin.style.roll;

  return (
    <article
      className="flex flex-col gap-3 rounded-card border border-dashed border-primary/35 bg-primary/[0.03] p-3"
      data-testid={`style-candidate-${n}`}
    >
      <div className="flex items-start gap-2">
        <p className="typo-title flex-1 min-w-0">{candidate.name}</p>
        <Badge variant="violet" size="sm">
          <Dices className="w-3 h-3" aria-hidden="true" />
          {ts.badge}
        </Badge>
      </div>
      <p className="typo-body text-foreground">{candidate.summary}</p>
      <p className="typo-caption italic">{candidate.avoid}</p>
      <StyleSample reply={candidate.sample} />
      <DimensionChips dims={candidate.dims} pins={pins} onTogglePin={onTogglePin} />
      <Button
        variant="accent"
        tone="agent"
        size="sm"
        className="mt-auto self-start"
        onClick={() => onUse(candidate.id)}
        data-testid={`style-candidate-use-${n}`}
      >
        {ts.use}
      </Button>
    </article>
  );
}

export default CandidateCard;
