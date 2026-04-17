import { EFFORT_OPTIONS, type EffortLevel } from '@/lib/models/modelCatalog';

interface EffortToggleGridProps {
  selectedEfforts: Set<EffortLevel>;
  toggleEffort: (id: EffortLevel) => void;
  testIdPrefix?: string;
}

/**
 * Mirror of `ModelToggleGrid` for the Claude `--effort` dimension.
 *
 * The lab can vary effort alongside model — each (model, effort) pair becomes
 * a single test cell. When the user leaves only one effort selected (the
 * default `medium`), the grid behaves identically to a model-only run.
 */
export function EffortToggleGrid({ selectedEfforts, toggleEffort, testIdPrefix }: EffortToggleGridProps) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">Effort</label>
      <div
        className="flex flex-wrap gap-2"
        data-testid={testIdPrefix ? `${testIdPrefix}-effort-selector` : undefined}
      >
        {EFFORT_OPTIONS.map((e) => (
          <button
            key={e.id}
            onClick={() => toggleEffort(e.id)}
            data-testid={testIdPrefix ? `${testIdPrefix}-effort-${e.id}` : undefined}
            className={`px-2.5 py-1 rounded-modal text-sm font-medium border transition-all cursor-pointer ${selectedEfforts.has(e.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-foreground border-primary/10 hover:border-primary/20 hover:text-foreground/95'}`}
          >
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}
