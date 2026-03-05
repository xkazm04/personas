import { Plus, Trash2, Clock, Hand, Webhook, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { BuilderUseCase, TriggerPreset } from './types';
import { TRIGGER_PRESETS } from './types';

interface UseCaseBuilderProps {
  useCases: BuilderUseCase[];
  onAdd: () => void;
  onUpdate: (id: string, updates: Partial<BuilderUseCase>) => void;
  onRemove: (id: string) => void;
}

const triggerIcons: Record<string, typeof Clock> = {
  manual: Hand,
  schedule: Clock,
  webhook: Webhook,
};

function TriggerPopover({
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
        className={`p-1.5 rounded-md border transition-all ${
          value
            ? 'bg-primary/10 border-primary/25 text-primary'
            : 'bg-secondary/30 border-primary/10 text-muted-foreground/65 hover:text-muted-foreground/80'
        }`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute z-50 left-0 top-full mt-1 bg-background border border-primary/15 rounded-xl shadow-xl p-2 min-w-[180px]"
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
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg text-muted-foreground/65 hover:bg-secondary/40 mt-0.5 border-t border-primary/12 pt-1.5"
              >
                <X className="w-3 h-3 shrink-0" />
                Clear override
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UseCaseCard({
  useCase,
  index,
  onUpdate,
  onRemove,
}: {
  useCase: BuilderUseCase;
  index: number;
  onUpdate: (updates: Partial<BuilderUseCase>) => void;
  onRemove: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="border border-primary/12 rounded-xl bg-secondary/20">
        {/* Header row: index + title + remove */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-sm text-muted-foreground/55 font-mono w-5 shrink-0">#{index + 1}</span>
          <input
            type="text"
            value={useCase.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="Use case title..."
            className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground placeholder-muted-foreground/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={onRemove}
            className="p-1 text-muted-foreground/50 hover:text-red-400 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Description row with trigger icon on the left */}
        <div className="flex items-start gap-2 px-3 pb-2.5">
          <div className="mt-1 shrink-0">
            <TriggerPopover
              value={useCase.trigger}
              onChange={(preset) => onUpdate({ trigger: preset })}
            />
          </div>
          <textarea
            value={useCase.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="What does this use case do?"
            rows={1}
            className="flex-1 min-w-0 px-2 py-1.5 bg-secondary/30 border border-primary/10 rounded-lg text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
        </div>
      </div>
    </motion.div>
  );
}

export function UseCaseBuilder({ useCases, onAdd, onUpdate, onRemove }: UseCaseBuilderProps) {
  return (
    <div className="space-y-2">
      <AnimatePresence mode="popLayout">
        {useCases.map((uc, i) => (
          <UseCaseCard
            key={uc.id}
            useCase={uc}
            index={i}
            onUpdate={(updates) => onUpdate(uc.id, updates)}
            onRemove={() => onRemove(uc.id)}
          />
        ))}
      </AnimatePresence>

      <button
        type="button"
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground/70 border border-dashed border-primary/20 rounded-xl hover:bg-secondary/30 hover:text-foreground/80 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add use case
      </button>
    </div>
  );
}
