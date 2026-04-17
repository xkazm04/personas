import { Zap } from 'lucide-react';
import {
  TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, TRIGGER_CATEGORIES,
  type TriggerCategory,
} from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

export interface TriggerCategorySelectorProps {
  selectedCategory: TriggerCategory | null;
  onSelectCategory: (category: TriggerCategory | null) => void;
  onSelectTriggerType: (type: string) => void;
}

export function TriggerCategorySelector({
  selectedCategory, onSelectCategory, onSelectTriggerType,
}: TriggerCategorySelectorProps) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block text-sm font-medium text-foreground/80 mb-1.5">
        Trigger Category
      </label>
      <div className="grid grid-cols-2 gap-2">
        {TRIGGER_CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat.id;
          const firstType = cat.types[0];
          const CatIcon = firstType ? (TRIGGER_TYPE_META[firstType] || DEFAULT_TRIGGER_META).Icon : Zap;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                onSelectCategory(isActive ? null : cat.id);
                if (!isActive) onSelectTriggerType(cat.types[0]!);
              }}
              className={`flex flex-col gap-1.5 p-3 rounded-modal border text-left transition-all cursor-pointer ${
                isActive
                  ? `${cat.bgColor} ${cat.borderColor} ring-1 ring-primary/15`
                  : 'border-primary/15 bg-background/50 hover:border-primary/25 hover:bg-secondary/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <CatIcon className={`w-4 h-4 ${cat.color}`} />
                <span className="text-sm font-semibold text-foreground/90">{cat.label}</span>
                <span className="ml-auto text-xs text-muted-foreground/50">{cat.types.length}</span>
              </div>
              <span className="text-xs text-muted-foreground/70">{cat.description}</span>
            </button>
          );
        })}
        {/* Manual card */}
        <button
          type="button"
          onClick={() => {
            onSelectCategory('manual');
            onSelectTriggerType('manual');
          }}
          className={`flex flex-col gap-1.5 p-3 rounded-modal border text-left transition-all cursor-pointer ${
            selectedCategory === 'manual'
              ? 'bg-emerald-500/10 border-emerald-500/20 ring-1 ring-primary/15'
              : 'border-primary/15 bg-background/50 hover:border-primary/25 hover:bg-secondary/30'
          }`}
        >
          <div className="flex items-center gap-2">
            {(() => { const ManualIcon = TRIGGER_TYPE_META.manual?.Icon ?? Zap; return <ManualIcon className="w-4 h-4 text-emerald-400" />; })()}
            <span className="text-sm font-semibold text-foreground/90">{t.triggers.category_manual}</span>
          </div>
          <span className="text-xs text-muted-foreground/70">{t.triggers.category_manual_hint}</span>
        </button>
      </div>
    </div>
  );
}
