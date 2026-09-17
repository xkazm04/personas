import { AnimatePresence } from 'framer-motion';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaVariantProps } from '../engine/createAthenaTypes';
import { ConversationStepDots } from './conversation/ConversationStepDots';
import { ConversationExchange } from './conversation/ConversationExchange';

/**
 * Create Athena — "Conversation" shell. A private exchange with Athena and
 * nothing else on screen: a centered column, step dots above, her line and
 * the one card below it, and three quiet text links in the corner. Strictly
 * one line + one card mounted at a time; a step change plays the old
 * exchange out before the new one types in (`AnimatePresence mode="wait"`,
 * keyed on the line id).
 */
export default function CreateAthenaConversation({ engine }: CreateAthenaVariantProps) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions, canBack, stepId } = engine;
  const atHandoff = stepId === 'handoff';

  return (
    <div
      className="relative h-full min-h-0 flex flex-col items-center px-4"
      data-testid="create-athena-conversation"
    >
      <div className="w-full max-w-[640px] pt-3 pb-6 shrink-0">
        <ConversationStepDots steps={engine.steps} stepIndex={engine.stepIndex} />
      </div>

      <div className="w-full max-w-[640px] flex-1 min-h-0 overflow-y-auto flex flex-col justify-center py-4">
        <AnimatePresence mode="wait" initial={false}>
          <ConversationExchange key={engine.line.id} engine={engine} />
        </AnimatePresence>
      </div>

      <div className="w-full max-w-[640px] shrink-0 flex items-center gap-1 pt-4 pb-2">
        {canBack && (
          <Button
            variant="ghost"
            size="xs"
            className="typo-caption text-foreground/85"
            onClick={actions.back}
            data-testid="create-athena-back"
          >
            {c.create_back}
          </Button>
        )}
        {!atHandoff && (
          <Button
            variant="ghost"
            size="xs"
            className="typo-caption text-foreground/85"
            onClick={actions.skip}
            data-testid="create-athena-skip"
          >
            {c.create_skip}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="typo-caption text-foreground/85"
          onClick={actions.restart}
          data-testid="create-athena-restart"
        >
          {c.create_restart}
        </Button>
      </div>
    </div>
  );
}
