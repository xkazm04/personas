/**
 * Combined capability + trigger composition step. All three variants
 * share the same layout (2-column tile grid with inline trigger config
 * per card) and the same props contract. They differ purely in visual
 * language so the user can pick the styling that fits best.
 *
 * Styling variants (per ui-variant-prototype skill):
 *   - outline   → neutral borders, minimal hue, current-app aesthetic
 *   - filled    → pill chips with accent-per-preset colors, soft glow
 *                 on enabled cards, gradient CTA
 *   - segmented → joined segmented-control chips, monochrome palette,
 *                 underline-only inputs, Apple-settings-like
 *
 * Swapping is pure UI — behavior, data flow, and trigger materialization
 * are unaffected.
 */
import { useState } from 'react';
import { SquareDashed, Zap, Minus, type LucideIcon } from 'lucide-react';
import { UseCasePickerStepGridOutline } from './UseCasePickerStepGridOutline';
import { UseCasePickerStepGridFilled } from './UseCasePickerStepGridFilled';
import { UseCasePickerStepGridSegmented } from './UseCasePickerStepGridSegmented';
import type { UseCaseOption, UseCasePickerVariantProps } from './useCasePickerShared';

export type { UseCaseOption };

type Variant = 'outline' | 'filled' | 'segmented';

const VARIANTS: { key: Variant; label: string; icon: LucideIcon }[] = [
  { key: 'outline', label: 'Outline', icon: SquareDashed },
  { key: 'filled', label: 'Filled', icon: Zap },
  { key: 'segmented', label: 'Segmented', icon: Minus },
];

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  const [variant, setVariant] = useState<Variant>('outline');

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 flex items-center justify-center gap-1 px-6 pt-4 pb-2 bg-background">
        <div className="inline-flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          {VARIANTS.map((v) => {
            const VIcon = v.icon;
            const active = variant === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setVariant(v.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 typo-body-lg font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.08] text-foreground'
                    : 'text-foreground/55 hover:bg-white/[0.04] hover:text-foreground/80'
                }`}
              >
                <VIcon className="w-3.5 h-3.5" />
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {variant === 'outline' && <UseCasePickerStepGridOutline {...props} />}
        {variant === 'filled' && <UseCasePickerStepGridFilled {...props} />}
        {variant === 'segmented' && <UseCasePickerStepGridSegmented {...props} />}
      </div>
    </div>
  );
}
