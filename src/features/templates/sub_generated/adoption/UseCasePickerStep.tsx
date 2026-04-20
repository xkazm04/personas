/**
 * Combined capability + trigger composition step. Hosts three variants
 * behind a tab switcher so the user can A/B/C the layouts on real
 * template data before we commit to one and delete the others.
 *
 * Variants (per ui-variant-prototype skill):
 *   - grid  → Command Grid (dense 2-col tiles, inline trigger config)
 *   - split → Split Pane (master list + detail config pane)
 *   - stack → Stack Accordion (progressive disclosure, one-open-at-a-time)
 *
 * All three share the same props contract (UseCasePickerVariantProps)
 * so swapping is pure UI — behavior, data flow, and materialization are
 * unaffected.
 */
import { useState } from 'react';
import { Grid3x3, Columns2, LayoutList, type LucideIcon } from 'lucide-react';
import { UseCasePickerStepGrid } from './UseCasePickerStepGrid';
import { UseCasePickerStepSplit } from './UseCasePickerStepSplit';
import { UseCasePickerStepStack } from './UseCasePickerStepStack';
import type { UseCaseOption, UseCasePickerVariantProps } from './useCasePickerShared';

export type { UseCaseOption };

type Variant = 'grid' | 'split' | 'stack';

const VARIANTS: { key: Variant; label: string; icon: LucideIcon }[] = [
  { key: 'grid', label: 'Grid', icon: Grid3x3 },
  { key: 'split', label: 'Split pane', icon: Columns2 },
  { key: 'stack', label: 'Stack', icon: LayoutList },
];

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  const [variant, setVariant] = useState<Variant>('grid');

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
        {variant === 'grid' && <UseCasePickerStepGrid {...props} />}
        {variant === 'split' && <UseCasePickerStepSplit {...props} />}
        {variant === 'stack' && <UseCasePickerStepStack {...props} />}
      </div>
    </div>
  );
}
