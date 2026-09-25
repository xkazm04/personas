// A refetch failed behind data that is still on screen: say so quietly, under
// the chrome, with a retry — the rows stay (law 1), but they must not look live
// while the backend has stopped answering.
import { RotateCcw } from 'lucide-react';

import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export function RefreshFailed({ onRetry, testId }: { onRetry: () => Promise<void>; testId: string }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-1.5 typo-caption text-status-warning" role="status" data-testid={testId}>
      {t.plugins.contest.arena.refresh_failed}
      <AsyncButton size="xs" variant="ghost" className="typo-caption" icon={<RotateCcw className="w-3 h-3" />} onClick={onRetry}>
        {t.common.retry}
      </AsyncButton>
    </p>
  );
}
