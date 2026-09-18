/**
 * The randomizer's surface: three rolled candidates side by side (stacking on
 * narrow widths), the pins bar, and Reroll. The header and the pins bar are
 * permanent chrome; only the three cards swap for a ghost while rolling.
 */

import { ArrowLeft, Dices } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { CandidateCard } from './CandidateCard';
import { CandidatesGhost } from './StyleGhosts';
import { STYLE_GRID } from './PresetGallery';
import type { StyleStudioApi } from './styleContract';

export function RollCandidates({ studio }: { studio: StyleStudioApi }) {
  const { t } = useTranslation();
  const ts = t.twin.style.roll;
  const rolling = studio.phase === 'rolling';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="typo-title">{ts.title}</p>
          <p className="typo-caption">{ts.hint}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={studio.back} icon={<ArrowLeft className="w-3.5 h-3.5" />}>
          {ts.back}
        </Button>
        <AsyncButton
          onClick={studio.roll}
          isLoading={rolling}
          loadingText={ts.rerolling}
          variant="secondary"
          size="sm"
          icon={<Dices className="w-3.5 h-3.5" />}
          data-testid="style-reroll"
        >
          {ts.reroll}
        </AsyncButton>
      </div>

      {rolling && studio.candidates.length === 0 ? (
        <CandidatesGhost label={ts.loading} />
      ) : (
        <div className={`${STYLE_GRID} ${rolling ? 'opacity-60 pointer-events-none' : ''}`} aria-busy={rolling}>
          {studio.candidates.map((candidate, i) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              n={i + 1}
              pins={studio.pins}
              onTogglePin={studio.togglePin}
              onUse={studio.pickCandidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default RollCandidates;
