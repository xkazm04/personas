import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaActions, CreateAthenaCard } from '../../engine/createAthenaTypes';
import { useStepLabel } from './StageRail';

/**
 * Keep / turn-off decision for one chrome feature (footer icon, orb, chime).
 * The feature is already live in the real chrome; the toggle mirrors the real
 * store key, and the two explicit buttons make the choice unambiguous. The
 * recommended option wears the pill and the one-line reason sits under the
 * header. Nothing applies on silence: `choice` stays `null` until a tap.
 * The chime card also offers "Play it again" (`actions.replayChime`).
 */
export function StageCardKeepToggle({
  card,
  actions,
}: {
  card: Extract<CreateAthenaCard, { kind: 'keep_toggle' }>;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const stepLabel = useStepLabel();
  const pill = (
    <span className="ml-2 inline-flex items-center px-1.5 py-px rounded-pill bg-primary/15 text-primary typo-caption">
      {c.create_recommended}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="typo-title text-foreground">{stepLabel(card.feature)}</h3>
          <p className="typo-caption text-foreground/85 mt-0.5">{card.why}</p>
        </div>
        <AccessibleToggle
          checked={card.enabled}
          onChange={() => actions.keepFeature(card.feature, !card.enabled)}
          label={stepLabel(card.feature)}
          data-testid="create-athena-keep-toggle"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={stepLabel(card.feature)}>
        <Button
          variant={card.choice === 'keep' ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={card.choice === 'keep'}
          onClick={() => actions.keepFeature(card.feature, true)}
          data-testid="create-athena-keep"
        >
          {c.create_keep}
          {card.recommended === 'keep' && pill}
        </Button>
        <Button
          variant={card.choice === 'off' ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={card.choice === 'off'}
          onClick={() => actions.keepFeature(card.feature, false)}
          data-testid="create-athena-turn-off"
        >
          {c.create_turn_off}
          {card.recommended === 'off' && pill}
        </Button>
        {card.feature === 'chime' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.replayChime}
            data-testid="create-athena-chime-replay"
          >
            {c.create_chime_play}
          </Button>
        )}
      </div>
    </div>
  );
}
