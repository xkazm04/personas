import { ANTHROPIC_MODELS, OLLAMA_LOCAL_MODELS } from '@/lib/models/modelCatalog';
import { useTranslation } from '@/i18n/useTranslation';

interface ModelToggleGridProps {
  selectedModels: Set<string>;
  toggleModel: (id: string) => void;
  testIdPrefix?: string;
}

export function ModelToggleGrid({ selectedModels, toggleModel, testIdPrefix }: ModelToggleGridProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-muted-foreground/80">{t.agents.lab.models_header}</label>
      <div className="flex flex-wrap gap-2" data-testid={testIdPrefix ? `${testIdPrefix}-model-selector` : undefined}>
        {ANTHROPIC_MODELS.map((m) => (
          <button key={m.id} onClick={() => toggleModel(m.id)}
            data-testid={testIdPrefix ? `${testIdPrefix}-model-${m.id}` : undefined}
            className={`px-2.5 py-1 rounded-xl text-sm font-medium border transition-all cursor-pointer ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'}`}>
            {m.label}
          </button>
        ))}
      </div>
      {OLLAMA_LOCAL_MODELS.length > 0 && (
        <>
          <label className="text-xs font-medium text-muted-foreground/60 mt-2 pt-1 border-t border-primary/8">{t.agents.lab.ollama_local}</label>
          <div className="flex flex-wrap gap-2">
            {OLLAMA_LOCAL_MODELS.map((m) => (
              <button key={m.id} onClick={() => toggleModel(m.id)}
                data-testid={testIdPrefix ? `${testIdPrefix}-model-${m.id}` : undefined}
                className={`px-2.5 py-1 rounded-xl text-sm font-medium border transition-all cursor-pointer ${selectedModels.has(m.id) ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-emerald-500/20 hover:text-foreground/95'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
