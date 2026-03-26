import { Check } from 'lucide-react';
export function ToolCheckbox({
  toolName,
  checked,
  disabled,
  justToggled: _justToggled,
  size,
  onToggle,
}: {
  toolName: string;
  checked: boolean;
  disabled: boolean;
  justToggled: boolean;
  size: 'sm' | 'md';
  onToggle: () => void;
}) {
  const classes = size === 'md'
    ? 'w-5 h-5 rounded-lg'
    : 'w-4 h-4 rounded-lg';
  const checkClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={toolName}
      aria-disabled={disabled ? true : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !disabled) {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`animate-fade-in flex-shrink-0 border flex items-center justify-center mt-0.5 transition-colors focus-ring ${classes} ${
        checked ? 'bg-primary border-primary' : 'bg-background/50 border-primary/20'
      }`}
    >
      {checked && <Check className={`${checkClass} text-foreground`} />}
    </div>
  );
}
