import { Crosshair } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * Per-row affordance that points the hero sigil at this charter WITHOUT
 * opening its detail. Without it the only way to change which charter the
 * petals edit would be to drill into a charter and come back out.
 */
export function CharterFocusButton({ charterId, onFocus }: { charterId: string; onFocus: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t.agents.responsibilities.focus_sigil} placement="top">
      <span>
        <Button
          size="xs"
          variant="ghost"
          icon={<Crosshair className="w-3.5 h-3.5" />}
          onClick={onFocus}
          aria-label={t.agents.responsibilities.focus_sigil}
          data-testid={`resp-focus-${charterId}`}
        >
          {''}
        </Button>
      </span>
    </Tooltip>
  );
}
