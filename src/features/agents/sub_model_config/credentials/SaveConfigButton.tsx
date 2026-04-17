import { useTranslation } from '@/i18n/useTranslation';

interface SaveConfigButtonProps {
  onClick: () => void;
  disabled: boolean;
  saved: boolean;
  label?: string;
}

export function SaveConfigButton({ onClick, disabled, saved, label }: SaveConfigButtonProps) {
  const { t } = useTranslation();
  const displayLabel = label ?? t.common.save;
  return (
    <button
      onClick={onClick}
      disabled={disabled || saved}
      className={`px-3 py-1.5 rounded-modal text-sm font-medium transition-all ${
        saved
          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : !disabled
            ? 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
            : 'bg-secondary/40 text-muted-foreground/80 border border-primary/10 cursor-not-allowed'
      }`}
    >
      {saved ? t.agents.model_config.saved : displayLabel}
    </button>
  );
}
