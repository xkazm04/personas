import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';

type IntroCardData = Extract<CreateAthenaCard, { kind: 'intro' }>;

/**
 * "Ready?" — one primary button. "Skip the tour" only appears on a re-run
 * (`mode === 'done'`), where it means "leave things as they are" and maps to
 * `finish()`; the contract has no skip-all action for a fresh run.
 */
export function IntroCard({ card, engine }: { card: IntroCardData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const label = card.mode === 'resume' ? c.create_resume : c.create_start;

  return (
    <div className="flex items-center justify-end gap-2">
      {card.mode === 'done' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={engine.actions.finish}
          data-testid="create-athena-skip-all"
        >
          {c.create_skip_all}
        </Button>
      )}
      <Button
        variant="primary"
        size="md"
        onClick={engine.actions.next}
        data-testid="create-athena-intro-start"
      >
        {label}
      </Button>
    </div>
  );
}
