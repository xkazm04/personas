import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, TRIGGER_TEMPLATES } from '@/lib/utils/platform/triggerConstants';

export interface TriggerQuickTemplatesProps {
  onApplyTemplate: (templateId: string) => void;
}

export function TriggerQuickTemplates({ onApplyTemplate }: TriggerQuickTemplatesProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        Quick Templates
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        {TRIGGER_TEMPLATES.map((tpl) => {
          const meta = TRIGGER_TYPE_META[tpl.triggerType] || DEFAULT_TRIGGER_META;
          const Icon = meta.Icon;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onApplyTemplate(tpl.id)}
              className="flex items-start gap-2.5 p-2.5 rounded-modal border border-primary/10 bg-background/30 hover:border-primary/25 hover:bg-secondary/30 transition-all text-left group"
            >
              <Icon className={`w-4 h-4 mt-0.5 ${meta.color} shrink-0`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/90 truncate">{tpl.label}</p>
                <p className="text-sm text-foreground line-clamp-1">{tpl.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
