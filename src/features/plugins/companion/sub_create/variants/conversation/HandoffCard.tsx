import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';

type HandoffData = Extract<CreateAthenaCard, { kind: 'handoff' }>;

/** The last card: one big button into the chat, and a caption if there is no Claude login yet. */
export function HandoffCard({ card, engine }: { card: HandoffData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;

  return (
    <div className="flex flex-col items-end gap-2">
      <AsyncButton
        variant="primary"
        size="lg"
        className="w-full"
        onClick={async () => {
          engine.actions.finish();
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
