import { Clock, Webhook, Hand } from 'lucide-react';
import type { TriggerPreset } from './types';
import { TRIGGER_PRESETS } from './types';

interface TriggerPresetPickerProps {
  value: TriggerPreset | null;
  onChange: (preset: TriggerPreset | null) => void;
}

const typeIcons: Record<string, typeof Clock> = {
  manual: Hand,
  schedule: Clock,
  webhook: Webhook,
};

export function TriggerPresetPicker({ value, onChange }: TriggerPresetPickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TRIGGER_PRESETS.map((preset) => {
        const Icon = typeIcons[preset.type] ?? Clock;
        const active = value?.label === preset.label;
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(active ? null : preset)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              active
                ? 'bg-primary/12 border-primary/30 text-primary ring-1 ring-primary/20'
                : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50 hover:text-foreground/80'
            }`}
          >
            <Icon className="w-3 h-3" />
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
