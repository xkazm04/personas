import { useRef } from 'react';
import {
  TRIGGER_TYPE_META, DEFAULT_TRIGGER_META,
  TRIGGER_CATEGORIES, TRIGGER_TYPE_OPTIONS,
  type TriggerCategory,
} from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

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

  if (!selectedCategory || selectedCategory === 'manual') return null;

  const cat = TRIGGER_CATEGORIES.find((c) => c.id === selectedCategory);
  if (!cat) return null;

  const typeOptions = TRIGGER_TYPE_OPTIONS.filter((o) => cat.types.includes(o.type));

  return (
    <div>
      <label className="block text-sm font-medium text-foreground/80 mb-1.5">
        {t.triggers.type_selector.trigger_type}
      </label>
      <div
        className="grid grid-cols-3 gap-2"
        role="radiogroup"
        aria-label="Trigger type"
      >
        {typeOptions.map((option, index) => {
          const meta = TRIGGER_TYPE_META[option.type] || DEFAULT_TRIGGER_META;
          const Icon = meta.Icon;
          const colorClass = meta.color;
          const isSelected = triggerType === option.type;

          return (
            <button
              key={option.type}
              ref={(el) => { triggerTypeRefs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setTriggerType(option.type)}
              onKeyDown={(e) => {
                let nextIndex = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  nextIndex = (index + 1) % typeOptions.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  nextIndex = (index - 1 + typeOptions.length) % typeOptions.length;
                }
                if (nextIndex >= 0) {
                  setTriggerType(typeOptions[nextIndex]!.type);
                  triggerTypeRefs.current[nextIndex]?.focus();
                }
              }}
              className={`flex flex-col gap-1.5 p-3 rounded-modal border text-left transition-all focus-ring ${
                isSelected
                  ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                  : 'border-primary/15 bg-background/50 hover:border-primary/25 hover:bg-secondary/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${colorClass}`} />
                <span className="text-sm font-medium text-foreground/90">
                  {option.label}
                </span>
              </div>
              <span className="text-xs text-muted-foreground/70">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
