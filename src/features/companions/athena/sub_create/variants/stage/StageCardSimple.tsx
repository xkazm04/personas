import { Check, MessageSquare } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaActions, CreateAthenaCard } from '../../engine/createAthenaTypes';

/**
 * The three single-action cards: intro, orb placement, handoff. Each is one
 * decision, so each gets one primary control and nothing to compete with it.
 */
type CardOf<K extends CreateAthenaCard['kind']> = Extract<CreateAthenaCard, { kind: K }>;

export function StageCardIntro({
  card,
  actions,
}: {
  card: CardOf<'intro'>;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div className="flex flex-wrap items-center gap-3">
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

export function StageCardOrbPlace({
  card,
  actions,
}: {
  card: CardOf<'orb_place'>;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div className="flex items-center gap-3">
      <Button
        variant={card.confirmed ? 'secondary' : 'primary'}
        size="md"
        icon={card.confirmed ? <Check className="w-4 h-4 text-primary" aria-hidden="true" /> : undefined}
        onClick={actions.confirmOrbPlace}
        data-testid="create-athena-orb-place-done"
      >
        {c.create_orb_place_done}
      </Button>
    </div>
  );
}

export function StageCardHandoff({
  card,
  actions,
}: {
  card: CardOf<'handoff'>;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div className="space-y-3">
      <AsyncButton
        variant="primary"
        size="lg"
        block
        icon={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
        onClick={async () => {
          actions.finish();
        }}
        data-testid="create-athena-handoff-open"
      >
        {c.create_handoff_open}
      </AsyncButton>
      {!card.hasClaudeLogin && (
        <p className="typo-caption text-foreground/85" data-testid="create-athena-handoff-no-login">
          {c.create_handoff_no_login}
        </p>
      )}
    </div>
  );
}
