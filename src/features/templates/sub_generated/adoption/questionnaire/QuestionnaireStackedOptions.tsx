import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { QuestionnaireNormalizedOption } from './types';

/**
 * One-per-row option cards with numeric keyboard hints (1-9). Stackable
 * questions are always single-select — multi-select in this codebase lives
 * exclusively on `dynamic_source`, which uses SelectPills via QuestionCard.
 */
export function QuestionnaireStackedOptions({
  options,
  value,
  onChange,
}: {
  options: QuestionnaireNormalizedOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const selectedValue = value || null;

  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const isSelected = selectedValue === opt.value;
        const num = i < 9 ? i + 1 : null;
        return (
          <motion.button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.03 }}
            className={`w-full text-left rounded-card px-4 py-3 border flex items-center gap-4 transition-all ${
              isSelected
                ? 'bg-primary/10 border-primary/40 shadow-elevation-1'
                : 'bg-background/80 border-border hover:bg-foreground/[0.04] hover:border-foreground/20 backdrop-blur-sm'
            }`}
          >
            {num !== null ? (
              <kbd
                className={`flex-shrink-0 w-8 h-8 rounded-card flex items-center justify-center text-sm font-mono font-semibold transition-colors ${
                  isSelected
                    ? 'bg-primary/25 text-primary border border-primary/40'
                    : 'bg-foreground/[0.05] text-foreground/70 border border-border'
                }`}
              >
                {num}
              </kbd>
            ) : (
              <span className="flex-shrink-0 w-8 h-8 rounded-card bg-foreground/[0.05] border border-border" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium text-foreground leading-snug">
                {opt.label}
              </div>
              {opt.sublabel && (
                <div className="text-sm text-foreground/65 leading-snug mt-1">
                  {opt.sublabel}
                </div>
              )}
            </div>
            {isSelected && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
          </motion.button>
        );
      })}
    </div>
  );
}
