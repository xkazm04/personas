import { useMemo, useRef } from 'react';
import {
  TRIGGER_TYPE_META, DEFAULT_TRIGGER_META,
  getTriggerCategories, getTriggerTypeOptions,
  type TriggerCategory,
} from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

import { PressSurface } from '@/features/shared/components/buttons';
export interface TriggerTypeSelectorProps {
  selectedCategory: TriggerCategory | null;
  triggerType: string;
  setTriggerType: (v: string) => void;
}

export function TriggerTypeSelector({
  selectedCategory, triggerType, setTriggerType,
}: TriggerTypeSelectorProps) {
  const { t } = useTranslation();
  const triggerTypeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The `get*(t)` accessors, not the frozen English constants beside them:
  // every `triggers.type_*` / `triggers.desc_*` key this picker renders is
  // already translated, and reading the constants meant none of them shipped.
  // Both memos sit above the early returns — they are hooks.
  const categories = useMemo(() => getTriggerCategories(t), [t]);
  const allTypeOptions = useMemo(() => getTriggerTypeOptions(t), [t]);

  if (!selectedCategory || selectedCategory === 'manual') return null;

  const cat = categories.find((c) => c.id === selectedCategory);
  if (!cat) return null;

  const typeOptions = allTypeOptions.filter((o) => cat.types.includes(o.type));

  return (
    <div>
      <label className="block typo-body text-ink-1 mb-1.5">
        {t.triggers.type_selector.trigger_type}
      </label>
      <div
        className="grid grid-cols-3 gap-2"
        role="radiogroup"
        aria-label={t.triggers.type_selector.trigger_type}
      >
        {typeOptions.map((option, index) => {
          const meta = TRIGGER_TYPE_META[option.type] || DEFAULT_TRIGGER_META;
          const Icon = meta.Icon;
          const colorClass = meta.color;
          const isSelected = triggerType === option.type;

          return (
            <PressSurface key={option.type} ref={(el) => { triggerTypeRefs.current[index] = el; }} role="radio" aria-checked={isSelected} aria-pressed={undefined} selected={isSelected} tabIndex={isSelected ? 0 : -1} onPress={() => setTriggerType(option.type)} onKeyDown={(e) => { let nextIndex = -1; if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextIndex = (index + 1) % typeOptions.length; } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); nextIndex = (index - 1 + typeOptions.length) % typeOptions.length; } if (nextIndex >= 0) { setTriggerType(typeOptions[nextIndex]!.type); triggerTypeRefs.current[nextIndex]?.focus(); } }} className="flex flex-col gap-1.5 p-3 rounded-modal border border-hair">
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${colorClass}`} />
                <span className="typo-body text-ink-1">
                  {option.label}
                </span>
              </div>
              <span className="typo-caption text-ink-2">
                {option.description}
              </span>
            </PressSurface>
          );
        })}
      </div>
    </div>
  );
}
