/**
 * useSurfaceRow — read the full row an opened item's surface needs, by id.
 *
 * The roster carries a projection; the existing detail modals want the whole
 * row (an incident, a report, an idea). The read starts when the surface
 * mounts, so a failure is rendered IN the surface's place — a small modal with
 * the reason and a retry — rather than as a corner toast the person did not
 * ask for (error-surfacing policy).
 */
import { useCallback, useEffect, useState } from 'react';

import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { extractMessage } from '@/lib/silentCatch';

const TITLE_ID = 'decision-surface-read-error';

export function useSurfaceRow<T>(read: (id: string) => Promise<T>, id: string) {
  const [row, setRow] = useState<T | null>(null);
  /** The raw failure, resolved to the product's sentence at render. */
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailure(null);
    read(id).then(
      (r) => { if (live) setRow(r); },
      (cause: unknown) => { if (live) setFailure({ cause }); },
    );
    return () => { live = false; };
  }, [read, id, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { row, setRow, failure, retry };
}

/** The surface's place, when its row could not be read. */
export function SurfaceReadError({
  failure, onRetry, onClose,
}: {
  failure: { cause: unknown };
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} portal size="sm" staggerChildren={false}>
      <h2 id={TITLE_ID} className="sr-only">{t.monitor.dc_hub_open_failed}</h2>
      <div data-testid="decision-surface-read-error">
        <ErrorBanner
          variant="panel"
          message={`${t.monitor.dc_hub_open_failed} ${resolveErrorTranslated(t, extractMessage(failure.cause)).message}`}
          onRetry={onRetry}
          onBack={onClose}
        />
      </div>
    </BaseModal>
  );
}
