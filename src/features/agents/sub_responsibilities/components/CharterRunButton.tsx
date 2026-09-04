import { Play } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { executePersona } from '@/api/agents/executions';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';

interface CharterRunButtonProps {
  personaId: string;
  charterId: string;
  charterTitle: string;
  /** A charter that is not `active` is not dispatchable — say so, don't fail. */
  disabled?: boolean;
}

/**
 * Run ONE charter by hand.
 *
 * This restores an affordance the retired Use Cases tab carried ("Run Now" per
 * use case) and that the consolidation would otherwise have dropped: manual
 * per-capability dispatch survived only in Fleet -> Monitor and in the Lab, so
 * the agent's own editor lost the ability to exercise a single capability.
 *
 * The charter id travels in `executePersona`'s `useCaseId` slot. That is
 * deliberate and not a mistake: the executions command resolves that argument
 * to a charter by id FIRST and only falls back to `spec.migratedFromUseCaseId`,
 * so a charter id is the correct value post-cutover and the focused-run prompt
 * block (`_responsibility`) resolves from it.
 */
export function CharterRunButton({
  personaId,
  charterId,
  charterTitle,
  disabled,
}: CharterRunButtonProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const addToast = useToastStore((s) => s.addToast);

  return (
    <AsyncButton
      size="xs"
      variant="secondary"
      disabled={disabled}
      icon={<Play className="w-3 h-3" />}
      data-testid="resp-run-now"
      onClick={async () => {
        try {
          await executePersona(personaId, undefined, undefined, charterId);
          addToast(c.run_started.replace('{title}', charterTitle), 'success');
        } catch (err) {
          toastCatch('responsibilities:run', c.run_failed)(err);
        }
      }}
    >
      {c.run_now}
    </AsyncButton>
  );
}
