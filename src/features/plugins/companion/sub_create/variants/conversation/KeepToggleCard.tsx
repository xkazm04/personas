import Button from '@/features/shared/components/buttons/Button';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';

type KeepToggleData = Extract<CreateAthenaCard, { kind: 'keep_toggle' }>;

/**
 * Keep-or-turn-off for one chrome feature. The recommended choice carries
 * the "Recommended" pill and the one-line why; the chosen side stays
 * highlighted via `card.choice`. Continue unlocks once a choice is made.
 * The chime step also offers "Play it again" (`actions.replayChime`).
 */
export function KeepToggleCard({ card, engine }: { card: KeepToggleData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions, canNext } = engine;

  const title = {
    footer_icon: c.create_step_footer_icon,
    orb: c.create_step_orb,
    chime: c.create_step_chime,
  }[card.feature];

  const choice = (value: 'keep' | 'off') => {
    const recommended = card.recommended === value;
    const selected = card.choice === value;
    return (
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <Button
          variant={selected || (card.choice === null && recommended) ? 'primary' : 'secondary'}
          size="md"
          className="w-full"
          aria-pressed={selected}
          onClick={() => actions.keepFeature(card.feature, value === 'keep')}
          data-testid={`create-athena-choice-${value}`}
        >
          {value === 'keep' ? c.create_keep : c.create_turn_off}
        </Button>
        {recommended && (
          <div className="flex flex-col gap-1 px-1">
            <StatusBadge accent="emerald" size="sm" pill className="self-start">
              {c.create_recommended}
            </StatusBadge>
            <p className="typo-caption text-foreground/85">{card.why}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <p className="typo-label text-foreground">{title}</p>
      <div className="flex items-start gap-2">
        {choice('keep')}
        {choice('off')}
      </div>
      <div className="flex items-center justify-between gap-2">
        {card.feature === 'chime' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.replayChime}
            data-testid="create-athena-chime-replay"
          >
            {c.create_chime_play}
          </Button>
        ) : (
          <span />
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!canNext}
          onClick={actions.next}
          data-testid="create-athena-next"
        >
          {c.create_next}
        </Button>
      </div>
    </>
  );
}
