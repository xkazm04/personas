import { Brain } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { cardClass, descClass, fieldClass, inputClass, labelClass } from './tuneStepConstants';

export function MemoryCard({
  memoryEnabled,
  memoryScope,
  onUpdatePreference,
}: {
  memoryEnabled: boolean;
  memoryScope: string;
  onUpdatePreference: (key: string, value: unknown) => void;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-emerald-400/70"><Brain className="w-4 h-4" /></span>
        <span className="text-sm font-medium text-foreground/70">Memory</span>
      </div>

      <p className={`${descClass} mb-3`}>
        Persona retains learned patterns and preferences across runs
      </p>

      <div className="flex flex-col gap-3">
        {/* Memory enabled toggle */}
        <div className={fieldClass}>
          <label className={labelClass}>Memory enabled</label>
          <label
            className={`mt-1 inline-flex w-11 h-6 rounded-full border transition-colors items-center cursor-pointer ${
              memoryEnabled
                ? 'bg-emerald-500/30 border-emerald-500/40 justify-end'
                : 'bg-secondary/40 border-primary/15 justify-start'
            }`}
          >
            <input
              type="checkbox"
              role="switch"
              aria-checked={memoryEnabled}
              checked={memoryEnabled}
              onChange={() => onUpdatePreference('memoryEnabled', !memoryEnabled)}
              className="sr-only"
            />
            <div className={`w-4.5 h-4.5 rounded-full mx-0.5 transition-colors ${
              memoryEnabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'
            }`} />
          </label>
        </div>

        {/* Memory scope — structured categories + custom input */}
        <div className={fieldClass}>
          <label className={labelClass}>Memory scope</label>
          <p className={descClass}>What should the persona remember?</p>
          <ThemedSelect
            value={memoryScope.startsWith('custom:') ? 'custom' : memoryScope || 'all'}
            onChange={(e) => {
              const val = e.target.value;
              onUpdatePreference('memoryScope', val === 'custom' ? 'custom:' : val);
            }}
            className="py-1.5 px-2.5"
            disabled={!memoryEnabled}
          >
            <option value="all">Everything (default)</option>
            <option value="user_preferences">User preferences only</option>
            <option value="execution_patterns">Execution patterns</option>
            <option value="error_resolutions">Error resolutions</option>
            <option value="custom">Custom scope...</option>
          </ThemedSelect>
          {memoryScope.startsWith('custom:') && (
            <input
              type="text"
              value={memoryScope.replace('custom:', '')}
              onChange={(e) => onUpdatePreference('memoryScope', `custom:${e.target.value}`)}
              placeholder="Describe what to remember..."
              className={`${inputClass} mt-1.5`}
              disabled={!memoryEnabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}
