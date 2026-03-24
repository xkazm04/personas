import { Database } from 'lucide-react';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import type { PromptCachePolicy } from '@/lib/types/frontendTypes';

const POLICIES: { value: PromptCachePolicy; label: string; desc: string }[] = [
  { value: 'none', label: 'Off', desc: 'No caching' },
  { value: 'short', label: '5 min', desc: 'Short retention' },
  { value: 'long', label: '1 hr', desc: 'Long retention' },
];

interface PromptCacheControlsProps {
  value: PromptCachePolicy;
  onChange: (v: PromptCachePolicy) => void;
}

export function PromptCacheControls({ value, onChange }: PromptCacheControlsProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground/80 mb-1.5">
        <span className="flex items-center gap-1">
          <Database className="w-3 h-3" /> Prompt Caching
          <FieldHint
            text="Caches the system prompt across executions to reduce input token costs. Agents that run frequently with the same prompt benefit most."
            range="Off, 5 min, or 1 hr retention"
            example="5 min for cron-triggered agents"
          />
        </span>
      </label>
      <div className="flex gap-1.5">
        {POLICIES.map((p) => {
          const selected = value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              className={`flex-1 py-1.5 px-2 rounded-lg border text-sm font-medium transition-all ${
                selected
                  ? 'border-primary/40 bg-primary/10 text-foreground/90'
                  : 'border-primary/10 bg-secondary/30 text-muted-foreground/60 hover:border-primary/20 hover:bg-secondary/40'
              }`}
              title={p.desc}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
