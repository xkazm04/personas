import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
export function DesignPhaseApplying() {
  return (
    <div
      key="applying"
      className="animate-fade-slide-in flex flex-col items-center justify-center py-12 gap-3"
    >
      <LoadingSpinner size="xl" className="text-primary" />
      <span className="text-sm text-muted-foreground/80">Applying changes...</span>
    </div>
  );
}
