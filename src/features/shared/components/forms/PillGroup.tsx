import { useId } from 'react';
import { motion } from 'framer-motion';

export interface PillOption<T extends string | number = string> {
  value: T;
  label: string;
}

interface PillGroupProps<T extends string | number> {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Framer Motion layoutId prefix — must be unique per mounted instance */
  layoutId?: string;
  /** Active pill background class, e.g. "bg-cyan-500/15" */
  activeBg?: string;
  /** Active pill text class, e.g. "text-cyan-400" */
  activeText?: string;
  /** Active pill border class for the sliding indicator */
  activeBorder?: string;
  /** Optional custom input (e.g. number field) shown after the pills */
  customInput?: React.ReactNode;
  /** Whether the custom input is currently focused / expanded */
  customInputActive?: boolean;
  'data-testid'?: string;
}

export function PillGroup<T extends string | number>({
  options,
  value,
  onChange,
  layoutId: layoutIdProp,
  activeBg = 'bg-primary/15',
  activeText = 'text-foreground',
  activeBorder = 'border-primary/25',
  customInput,
  customInputActive = false,
  'data-testid': testId,
}: PillGroupProps<T>) {
  const autoId = useId();
  const lid = layoutIdProp ?? `pill-group-${autoId}`;

  return (
    <div
      className="inline-flex items-center rounded-xl overflow-hidden border border-primary/15 bg-secondary/20"
      role="radiogroup"
      data-testid={testId}
    >
      {/* Preset pills */}
      <div
        className={`relative inline-flex transition-all duration-200 ${
          customInputActive ? 'w-0 overflow-hidden opacity-0' : 'w-auto opacity-100'
        }`}
      >
        {options.map((opt) => {
          const isActive = opt.value === value && !customInputActive;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={`relative z-10 px-2.5 py-1 text-xs font-mono font-medium transition-colors cursor-pointer ${
                isActive ? activeText : 'text-foreground hover:text-foreground/80'
              }`}
              data-testid={testId ? `${testId}-${opt.value}` : undefined}
            >
              {isActive && (
                <motion.span
                  layoutId={lid}
                  className={`absolute inset-0 rounded-lg ${activeBg} border ${activeBorder}`}
                  style={{ zIndex: -1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Custom input slot */}
      {customInput && (
        <div
          className={`transition-all duration-200 overflow-hidden ${
            customInputActive ? 'max-w-40 opacity-100' : 'max-w-16 opacity-100'
          }`}
        >
          {customInput}
        </div>
      )}
    </div>
  );
}
