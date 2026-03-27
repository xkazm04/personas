import { ANTHROPIC_MODELS } from '@/lib/models/modelCatalog';

interface ModelToggleGridProps {
  selectedModels: Set<string>;
  toggleModel: (id: string) => void;
  testIdPrefix?: string;
}

export function ModelToggleGrid({ selectedModels, toggleModel, testIdPrefix }: ModelToggleGridProps) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-muted-foreground/80">Models</label>
      <div className="flex flex-wrap gap-2" data-testid={testIdPrefix ? `${testIdPrefix}-model-selector` : undefined}>
        {ANTHROPIC_MODELS.map((m) => (
          <button key={m.id} onClick={() => toggleModel(m.id)}
            data-testid={testIdPrefix ? `${testIdPrefix}-model-${m.id}` : undefined}
            className={`px-2.5 py-1 rounded-xl text-sm font-medium border transition-all cursor-pointer ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'}`}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
