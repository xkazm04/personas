import { useState, useRef, useEffect } from 'react';
import { Clock, Hand, Webhook, X } from 'lucide-react';
import type { TriggerPreset } from '../../steps/builder/types';
import { TRIGGER_PRESETS } from '../../steps/builder/types';

export const triggerIcons: Record<string, typeof Clock> = {
  manual: Hand,
  schedule: Clock,
  webhook: Webhook,
};

export function TriggerPopover({
  value,
  onChange,
}: {
  value: TriggerPreset | null;
  onChange: (preset: TriggerPreset | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const manualDefault: TriggerPreset = { label: 'Manual only', type: 'manual' };
  const current = value ?? TRIGGER_PRESETS[0] ?? manualDefault;
  const Icon = triggerIcons[current.type] ?? Clock;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={current.label}
        className={`p-1.5 rounded-lg border transition-all ${
          value
            ? 'bg-primary/10 border-primary/30 text-primary'
            : 'bg-secondary/30 border-primary/10 text-muted-foreground/65 hover:text-muted-foreground/80'
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>

      {open && (
          <div
            className="animate-fade-slide-in absolute z-50 left-0 top-full mt-1 bg-background border border-primary/20 rounded-xl shadow-elevation-3 p-2 min-w-[180px]"
          >
            <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider px-1.5 mb-1">
              Trigger
            </p>
            {TRIGGER_PRESETS.map((preset) => {
              const PresetIcon = triggerIcons[preset.type] ?? Clock;
              const active = value?.label === preset.label;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    onChange(active ? null : preset);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/70 hover:bg-secondary/40'
                  }`}
                >
                  <PresetIcon className="w-3 h-3 shrink-0" />
                  {preset.label}
                </button>
              );
            })}
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg text-muted-foreground/65 hover:bg-secondary/40 mt-0.5 border-t border-primary/20 pt-1.5"
              >
                <X className="w-3 h-3 shrink-0" />
                Clear override
              </button>
            )}
          </div>
        )}
    </div>
  );
}
