import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaActions, CreateAthenaCard } from '../../engine/createAthenaTypes';
import { ChoiceTile } from './ChoiceTile';

type KeepToggle = Extract<CreateAthenaCard, { kind: 'keep_toggle' }>;

/**
 * keep_toggle — two tiles: keep the feature or turn it off. The recommended
 * one carries the pill and the reason. The feature itself is already live
 * on screen (the engine flips the real store key on step entry), so the
 * tiles are the whole card.
 * The chime scene also offers "Play it again" (`actions.replayChime`).
 */
export function KeepToggleCard({ card, actions }: { card: KeepToggle; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const keepRecommended = card.recommended === 'keep';

  return (
    <div className="flex flex-col gap-3" data-feature={card.feature}>
      <div className="flex flex-col gap-3 sm:flex-row">
      <ChoiceTile
        title={c.create_keep}
        selected={card.choice === 'keep'}
        recommendedLabel={keepRecommended ? c.create_recommended : null}
        why={keepRecommended ? card.why : null}
        onSelect={() => actions.keepFeature(card.feature, true)}
        testId="create-athena-keep"
      />
      <ChoiceTile
        title={c.create_turn_off}
        selected={card.choice === 'off'}
        recommendedLabel={keepRecommended ? null : c.create_recommended}
        why={keepRecommended ? null : card.why}
        onSelect={() => actions.keepFeature(card.feature, false)}
        testId="create-athena-turn-off"
      />
      </div>
      {card.feature === 'chime' && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={actions.replayChime}
          data-testid="create-athena-chime-replay"
        >
          {c.create_chime_play}
        </Button>
      )}
    </div>
  );
}
