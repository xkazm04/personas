import type { ComponentType } from 'react';

interface DesignChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  buttonLabel: string;
  buttonIcon: ComponentType<{ className?: string }>;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function DesignChatInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  buttonLabel,
  buttonIcon: Icon,
  disabled,
  variant = 'primary',
}: DesignChatInputProps) {
  const isDisabled = disabled ?? !value.trim();

  const buttonStyles = isDisabled
    ? 'bg-secondary/40 text-muted-foreground/30 cursor-not-allowed'
    : variant === 'primary'
      ? 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
      : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20';

  return (
    <div className="flex items-end gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-h-[60px] max-h-[120px] bg-background/50 border border-primary/15 rounded-xl px-3 py-2 text-sm text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isDisabled) onSubmit();
          }
        }}
      />
      <button
        onClick={onSubmit}
        disabled={isDisabled}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${buttonStyles}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {buttonLabel}
      </button>
    </div>
  );
}
