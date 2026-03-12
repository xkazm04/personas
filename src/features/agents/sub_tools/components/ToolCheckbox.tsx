import { Check } from 'lucide-react';
import { motion } from 'framer-motion';

export function ToolCheckbox({
  toolName,
  checked,
  disabled,
  justToggled,
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
    <motion.div
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
      animate={justToggled ? { scale: [1, 1.3, 1] } : undefined}
      transition={{ duration: 0.3 }}
      className={`flex-shrink-0 border flex items-center justify-center mt-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${classes} ${
        checked ? 'bg-primary border-primary' : 'bg-background/50 border-primary/20'
      }`}
    >
      {checked && <Check className={`${checkClass} text-foreground`} />}
    </motion.div>
  );
}
