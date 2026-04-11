import { Database } from 'lucide-react';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import type { PromptCachePolicy } from '@/lib/types/frontendTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface PromptCacheControlsProps {
  value: PromptCachePolicy;
  onChange: (v: PromptCachePolicy) => void;
}

export function PromptCacheControls({ value, onChange }: PromptCacheControlsProps) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  const POLICIES: { value: PromptCachePolicy; label: string; desc: string }[] = [
    { value: 'none', label: mc.cache_off, desc: mc.cache_off_desc },
    { value: 'short', label: mc.cache_short, desc: mc.cache_short_desc },
    { value: 'long', label: mc.cache_long, desc: mc.cache_long_desc },
  ];
  return (
    <div>
      <label className="block text-sm font-medium text-foreground/80 mb-1.5">
        <span className="flex items-center gap-1">
          <Database className="w-3 h-3" /> {mc.prompt_caching}
          <FieldHint
            text={mc.prompt_caching_hint}
            range={mc.prompt_caching_range}
            example={mc.prompt_caching_example}
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
