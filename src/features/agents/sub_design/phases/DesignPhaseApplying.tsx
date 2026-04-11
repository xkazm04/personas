import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

export function DesignPhaseApplying() {
  const { t } = useTranslation();
  return (
    <div
      key="applying"
      className="animate-fade-slide-in flex flex-col items-center justify-center py-12 gap-3"
    >
      <LoadingSpinner size="xl" className="text-primary" />
      <span className="text-sm text-muted-foreground/80">{t.agents.design.applying_changes}</span>
    </div>
  );
}
