import { LoadingSpinner } from './LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

interface SuspenseFallbackProps {
  label?: string;
}

/** Lightweight centered spinner for use as a Suspense fallback. */
export function SuspenseFallback({ label }: SuspenseFallbackProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 items-center justify-center py-12 text-foreground">
      <LoadingSpinner size="lg" label={label ?? t.common.loading_label} />
    </div>
  );
}
