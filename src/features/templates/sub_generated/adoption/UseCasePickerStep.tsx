/**
 * Combined capability + trigger composition step. All three variants
 * rebuild the original Chip Grid baseline that tested well (cyan
 * accents, mono flourishes, composition badge top bar, shared-mode
 * strip, 2-col card grid, inline chips + contextual inputs) — they
 * differ only in visual language.
 *
 * Styling variants:
 *   - terminal  → the resurrected baseline. Cyan accents, rounded-xl
 *                 cards, chip pills with ring-on-active.
 *   - neon      → same DNA amplified. Cyan→violet gradient surface on
 *                 enabled cards, glow-on-active chips, gradient CTA.
 *   - blueprint → schematic feel. Hairline borders, graph-paper card
 *                 background, slate-blue accent, underline-active chips.
 *
 * Behavior, data flow, and trigger materialization are identical
 * across all three.
 */
import { useState } from 'react';
import { Terminal, Zap, Ruler, type LucideIcon } from 'lucide-react';
import { UseCasePickerStepTerminal } from './UseCasePickerStepTerminal';
import { UseCasePickerStepNeon } from './UseCasePickerStepNeon';
import { UseCasePickerStepBlueprint } from './UseCasePickerStepBlueprint';
import type { UseCaseOption, UseCasePickerVariantProps } from './useCasePickerShared';

export type { UseCaseOption };

type Variant = 'terminal' | 'neon' | 'blueprint';

const VARIANTS: { key: Variant; label: string; icon: LucideIcon }[] = [
  { key: 'terminal', label: 'Terminal', icon: Terminal },
  { key: 'neon', label: 'Neon', icon: Zap },
  { key: 'blueprint', label: 'Blueprint', icon: Ruler },
];

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  const [variant, setVariant] = useState<Variant>('terminal');

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
        {variant === 'terminal' && <UseCasePickerStepTerminal {...props} />}
        {variant === 'neon' && <UseCasePickerStepNeon {...props} />}
        {variant === 'blueprint' && <UseCasePickerStepBlueprint {...props} />}
      </div>
    </div>
  );
}
