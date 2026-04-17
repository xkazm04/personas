import { useState, useMemo } from 'react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { ModelOption } from './compareModels';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Output previews
// ---------------------------------------------------------------------------

export function OutputPreviews({
  modelA,
  modelB,
  results,
}: {
  modelA: ModelOption;
  modelB: ModelOption;
  results: LabArenaResult[];
}) {
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  const scenarios = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) set.add(r.scenarioName);
    return [...set];
  }, [results]);

  const { t } = useTranslation();

  if (scenarios.length === 0) return null;

  // If only one scenario, show it directly
  const firstScenario = scenarios.length === 1 ? scenarios[0]! : expandedScenario;

  return (
    <div className="space-y-2">
      <h5 className="typo-label font-medium text-foreground uppercase tracking-wider">{t.agents.model_config.output_previews}</h5>
      {scenarios.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {scenarios.map((s) => (
            <button
              key={s}
              onClick={() => setExpandedScenario(expandedScenario === s ? null : s)}
              className={`px-2 py-1 typo-caption rounded-card border transition-colors cursor-pointer ${
                expandedScenario === s
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {firstScenario && (
        <div className="grid grid-cols-2 gap-2">
          <OutputBox
            label={modelA.label}
            text={results.find((r) => r.modelId === modelA.id && r.scenarioName === firstScenario)?.outputPreview ?? ''}
            accent="blue"
          />
          <OutputBox
            label={modelB.label}
            text={results.find((r) => r.modelId === modelB.id && r.scenarioName === firstScenario)?.outputPreview ?? ''}
            accent="amber"
          />
        </div>
      )}
    </div>
  );
}

function NoOutputText() {
  const { t } = useTranslation();
  return <span className="text-foreground italic">{t.agents.model_config.no_output}</span>;
}

function OutputBox({ label, text, accent }: { label: string; text: string; accent: 'blue' | 'amber' }) {
  const borderCls = accent === 'blue' ? 'border-blue-500/20' : 'border-amber-500/20';
  const headerCls = accent === 'blue' ? 'text-blue-400/80' : 'text-amber-400/80';
  return (
    <div className={`rounded-modal border ${borderCls} overflow-hidden`}>
      <div className={`px-2.5 py-1.5 typo-caption font-medium ${headerCls} bg-secondary/30 border-b ${borderCls}`}>
        {label}
      </div>
      <div className="px-2.5 py-2 typo-code text-foreground max-h-32 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
        {text || <NoOutputText />}
      </div>
    </div>
  );
}
