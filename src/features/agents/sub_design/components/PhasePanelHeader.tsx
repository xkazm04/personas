import { Sparkles, Wand2, FlaskConical } from 'lucide-react';
import type { DesignInputMode } from '../libs/useDesignTabState';
import { useTranslation } from '@/i18n/useTranslation';

interface InputModeToggleProps {
  inputMode: DesignInputMode;
  onInputModeChange: (mode: DesignInputMode) => void;
}

export function InputModeToggle({ inputMode, onInputModeChange }: InputModeToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onInputModeChange('design')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-all border ${
          inputMode === 'design'
            ? 'bg-primary/10 text-primary border-primary/30'
            : 'bg-transparent text-foreground border-transparent hover:text-foreground/80'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        {t.agents.design.mode_design}
      </button>
      <button
        onClick={() => onInputModeChange('intent')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-all border ${
          inputMode === 'intent'
            ? 'bg-violet-500/10 text-violet-400 border-violet-500/25'
            : 'bg-transparent text-foreground border-transparent hover:text-foreground/80'
        }`}
      >
        <Wand2 className="w-3.5 h-3.5" />
        {t.agents.design.mode_intent}
      </button>
      <button
        onClick={() => onInputModeChange('example')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-all border ${
          inputMode === 'example'
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
            : 'bg-transparent text-foreground border-transparent hover:text-foreground/80'
        }`}
      >
        <FlaskConical className="w-3.5 h-3.5" />
        {t.agents.design.mode_example}
      </button>
    </div>
  );
}

interface AnalyzeButtonProps {
  disabled: boolean;
  onClick: () => void;
  variant: 'design' | 'intent' | 'example';
}

export function AnalyzeButton({ disabled, onClick, variant }: AnalyzeButtonProps) {
  const { t } = useTranslation();
  const configs = {
    design: { gradient: 'from-primary to-accent', shadow: 'shadow-primary/20 hover:shadow-primary/30', icon: <Sparkles className="w-4 h-4" />, label: t.agents.design.analyze_build },
    intent: { gradient: 'from-violet-500 to-fuchsia-500', shadow: 'shadow-violet-500/20 hover:shadow-violet-500/30', icon: <Wand2 className="w-4 h-4" />, label: t.agents.design.compile_intent },
    example: { gradient: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/20 hover:shadow-emerald-500/30', icon: <FlaskConical className="w-4 h-4" />, label: t.agents.design.compile_from_examples },
  };
  const cfg = configs[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-modal font-medium text-sm transition-all w-full ${
        disabled
          ? 'bg-secondary/60 text-foreground cursor-not-allowed'
          : `bg-gradient-to-r ${cfg.gradient} hover:from-${cfg.gradient.split(' ')[0]?.replace('from-', '') ?? ''}/90 hover:to-${cfg.gradient.split(' ')[1]?.replace('to-', '') ?? ''}/90 text-white shadow-elevation-3 ${cfg.shadow} hover:scale-[1.01] active:scale-[0.99]`
      }`}
    >
      {cfg.icon}
      {cfg.label}
    </button>
  );
}
