import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { CreateAthenaActions, CreateAthenaCard } from '../../engine/createAthenaTypes';

type CardOf<K extends CreateAthenaCard['kind']> = Extract<CreateAthenaCard, { kind: K }>;

/**
 * intro — one primary action. Fresh: start; resume: pick up; done: start
 * again, with a ghost "skip the tour" that finishes outright (the contract
 * has no dedicated skip-all, so `finish()` is the door).
 */
export function IntroCard({ card, actions }: { card: CardOf<'intro'>; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="lg" onClick={actions.next} data-testid="create-athena-start">
        {card.mode === 'resume' ? c.create_resume : c.create_start}
      </Button>
      {card.mode === 'done' && (
        <Button variant="ghost" size="lg" onClick={actions.finish} data-testid="create-athena-skip-all">
          {c.create_skip_all}
        </Button>
      )}
    </div>
  );
}

/** orb_place — the user drags the real orb; this only confirms the spot. */
export function OrbPlaceCard({ card, actions }: { card: CardOf<'orb_place'>; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <Button
      variant={card.confirmed ? 'secondary' : 'primary'}
      size="lg"
      onClick={actions.confirmOrbPlace}
      data-testid="create-athena-orb-place-done"
    >
      {c.create_orb_place_done}
    </Button>
  );
}

/** handoff — one large door into the chat. */
export function HandoffCard({ card, actions }: { card: CardOf<'handoff'>; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div className="flex flex-col items-start gap-3">
      <AsyncButton variant="primary" size="lg" onClick={actions.finish} data-testid="create-athena-handoff-open">
        {c.create_handoff_open}
      </AsyncButton>
      {!card.hasClaudeLogin && (
        <p className="typo-caption" data-testid="create-athena-handoff-no-login">
          {c.create_handoff_no_login}
        </p>
      )}
    </div>
  );
}
