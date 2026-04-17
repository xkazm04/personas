import { AlertCircle, RotateCcw, ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface DesignPhaseErrorProps {
  error: string | null;
  onRetry: () => void;
  onReset: () => void;
}

export function DesignPhaseError({ error, onRetry, onReset }: DesignPhaseErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      key="error"
      className="animate-fade-slide-in flex flex-col items-center py-8 gap-5"
    >
      <div
        className="animate-fade-slide-in w-14 h-14 rounded-full flex items-center justify-center bg-red-500/15 ring-2 ring-red-500/30"
      >
        <div className="animate-fade-scale-in"
        >
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
      </div>

      <div
        className="animate-fade-slide-in text-center"
      >
        <h3 className="text-base font-semibold text-red-400">{t.agents.design.design_failed}</h3>
        {error && (
          <p className="text-sm text-foreground mt-1.5 max-w-xs mx-auto">
            {error}
          </p>
        )}
      </div>

      <div
        className="animate-fade-slide-in flex items-center gap-3"
      >
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-modal text-sm font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t.common.retry}
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 rounded-modal text-sm font-medium bg-secondary/40 text-foreground hover:bg-secondary/60 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t.common.back}
        </button>
      </div>
    </div>
  );
}
