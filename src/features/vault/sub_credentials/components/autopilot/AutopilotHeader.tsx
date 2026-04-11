import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

type Step = 'input' | 'preview' | 'generated';

const STEP_KEYS: Record<Step, 'input_hint' | 'preview_hint' | 'generated_hint'> = {
  input: 'input_hint',
  preview: 'preview_hint',
  generated: 'generated_hint',
};

interface AutopilotHeaderProps {
  step: Step;
  error: string | null;
  onBack: () => void;
}

export function AutopilotHeader({ step, error, onBack }: AutopilotHeaderProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center gap-3">
        <button
          data-testid="vault-autopilot-back"
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{t.vault.autopilot.title}</h3>
          <p className="text-sm text-muted-foreground/60">{t.vault.autopilot[STEP_KEYS[step]]}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(['input', 'preview', 'generated'] as const).map((s, i) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step ? 'bg-blue-500' :
                (['input', 'preview', 'generated'].indexOf(step) > i) ? 'bg-blue-500/40' : 'bg-muted-foreground/20'
              }`}
            />
          ))}
        </div>
      </div>
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </>
  );
}
