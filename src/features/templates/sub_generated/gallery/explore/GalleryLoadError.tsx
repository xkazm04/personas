import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Shown when the gallery's first page failed to load, so a failed fetch is not
 * mistaken for an empty catalog. Retry re-requests page 0.
 */
export function GalleryLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center">
      <ErrorBanner variant="panel" message={t.agents.template_picker.failed_title} onRetry={onRetry} />
    </div>
  );
}
