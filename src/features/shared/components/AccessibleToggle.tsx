import { useCallback } from 'react';

interface AccessibleToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  /** Size variant: 'sm' = w-8 h-5, 'md' = w-9 h-5, 'lg' = w-11 h-6 */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AccessibleToggle({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
}: AccessibleToggleProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) onChange();
      }
    },
    [disabled, onChange],
  );

  const trackSize = size === 'lg' ? 'w-11 h-6' : size === 'sm' ? 'w-8 h-5' : 'w-9 h-5';
  const thumbSize = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  const thumbTranslate = size === 'lg' ? 'translate-x-[20px]' : size === 'sm' ? 'translate-x-[12px]' : 'translate-x-4';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      onKeyDown={handleKeyDown}
      className={`${trackSize} rounded-full relative transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        checked ? 'bg-emerald-500/80' : 'bg-muted-foreground/20'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 ${thumbSize} rounded-full bg-white shadow transition-transform ${
          checked ? thumbTranslate : 'translate-x-0'
        }`}
      />
      <span className="sr-only">{checked ? 'Enabled' : 'Disabled'}</span>
    </button>
  );
}
