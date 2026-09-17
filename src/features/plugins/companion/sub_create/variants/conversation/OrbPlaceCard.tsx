import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';

type OrbPlaceData = Extract<CreateAthenaCard, { kind: 'orb_place' }>;

/**
 * The instruction is Athena's line; the card only confirms the spot. Once
 * confirmed the button reads as done and Continue takes over.
 */
export function OrbPlaceCard({ card, engine }: { card: OrbPlaceData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions, canNext } = engine;

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant={card.confirmed ? 'secondary' : 'primary'}
        size="md"
        aria-pressed={card.confirmed}
        onClick={actions.confirmOrbPlace}
        data-testid="create-athena-orb-place-done"
      >
        {c.create_orb_place_done}
      </Button>
      <Button
        variant={card.confirmed ? 'primary' : 'secondary'}
        size="md"
        disabled={!canNext}
        onClick={actions.next}
        data-testid="create-athena-next"
      >
        {c.create_next}
      </Button>
    </div>
  );
}
