import { useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface AccessibleToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  /** Size variant: 'sm' = w-8 h-5, 'md' = w-10 h-6 (default) */
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
}

export function AccessibleToggle({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
  'data-testid': dataTestId,
}: AccessibleToggleProps) {
  const { t } = useTranslation();
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) onChange();
      }
    },
    [disabled, onChange],
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      onKeyDown={handleKeyDown}
      data-testid={dataTestId}
      className={`${size === 'sm' ? 'w-8 h-5' : 'w-10 h-6'} rounded-full relative transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        checked ? 'bg-emerald-500/80' : 'bg-muted-foreground/20'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 ${size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} rounded-full bg-white shadow-elevation-1 transition-transform duration-200 ${
          checked ? (size === 'sm' ? 'translate-x-3' : 'translate-x-4') : 'translate-x-0'
        }`}
      />
      <span className="sr-only">{checked ? t.common.enabled : t.common.disabled}</span>
    </button>
  );
}
