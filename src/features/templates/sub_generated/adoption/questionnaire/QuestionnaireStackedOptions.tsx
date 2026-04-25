import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { MOTION } from '../../../animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { QuestionnaireNormalizedOption } from './types';

/**
 * One-per-row option cards with numeric keyboard hints (1-9). Stackable
 * questions are always single-select — multi-select in this codebase lives
 * exclusively on `dynamic_source`, which uses SelectPills via QuestionCard.
 *
 * Numeric hotkey affordance: a small muted top-right badge fades in via the
 * `snappy` motion preset whenever the picker is focused (focus-within),
 * teaching power users about the 1-9 hotkey without cluttering the card for
 * mouse users. Hidden on coarse-pointer devices (touch) where keyboard
 * shortcuts don't apply, and respects `prefers-reduced-motion`.
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
  const { shouldAnimate } = useMotion();
  const [focused, setFocused] = useState(false);
  const showBadges = focused;
  const fadeTransition = shouldAnimate ? MOTION.snappy.framer : { duration: 0 };

  return (
    <div
      className="space-y-2"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => setFocused(false)}
    >
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
            className={`relative w-full text-left rounded-card px-4 py-3 border flex items-center gap-3 transition-all ${
              isSelected
                ? 'bg-primary/10 border-primary/40 shadow-elevation-1'
                : 'bg-background/80 border-border hover:bg-foreground/[0.04] hover:border-foreground/20 backdrop-blur-sm'
            }`}
          >
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

            {num !== null && (
              <AnimatePresence>
                {showBadges && (
                  <motion.kbd
                    key="hotkey-badge"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={fadeTransition}
                    aria-hidden="true"
                    className={`hide-on-touch absolute top-2 right-2 px-1.5 min-w-[1.25rem] h-5 rounded-md flex items-center justify-center font-mono text-[11px] font-semibold border pointer-events-none ${
                      isSelected
                        ? 'bg-primary/15 text-primary/85 border-primary/30'
                        : 'bg-foreground/[0.04] text-foreground/55 border-border/60'
                    }`}
                  >
                    {num}
                  </motion.kbd>
                )}
              </AnimatePresence>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
