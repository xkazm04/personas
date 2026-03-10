import { ANTHROPIC_MODELS, OLLAMA_MODELS, type ModelOption } from '@/lib/models/modelCatalog';

interface TestModelSelectorProps {
  selectedModels: Set<string>;
  toggleModel: (id: string) => void;
  disabled: boolean;
}

function ModelGroup({ label, models, selectedModels, toggleModel, disabled }: {
  label: string;
  models: ModelOption[];
  selectedModels: Set<string>;
  toggleModel: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">{label}</span>
      <div className="flex flex-wrap gap-2">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => toggleModel(m.id)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
              selectedModels.has(m.id)
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TestModelSelector({ selectedModels, toggleModel, disabled }: TestModelSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground/80">Select Models to Compare</label>
      <div className="space-y-2">
        <ModelGroup label="Anthropic" models={ANTHROPIC_MODELS} selectedModels={selectedModels} toggleModel={toggleModel} disabled={disabled} />
        {OLLAMA_MODELS.length > 0 && (
          <ModelGroup label="Ollama Cloud" models={OLLAMA_MODELS} selectedModels={selectedModels} toggleModel={toggleModel} disabled={disabled} />
        )}
      </div>
    </div>
  );
}
