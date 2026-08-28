import { useState, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { rowFailure, type ModelOption } from '../../libs/compareHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

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

  // Show the first scenario by default. Selecting one is a refinement, not a
  // precondition: a multi-scenario run used to render the chip row above an
  // empty gap until the user happened to click a chip.
  const activeScenario = expandedScenario ?? scenarios[0]!;

  return (
    <div className="space-y-2">
      <h5 className="typo-label font-medium text-foreground">{t.agents.model_config.output_previews}</h5>
      {scenarios.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {scenarios.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setExpandedScenario(s)}
              aria-pressed={activeScenario === s}
              className={`px-2 py-1 typo-caption rounded-card border transition-colors cursor-pointer ${
                activeScenario === s
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {activeScenario && (
        <div className="grid grid-cols-2 gap-2">
          <OutputBox
            label={modelA.label}
            row={results.find((r) => r.modelId === modelA.id && r.scenarioName === activeScenario)}
            accent="blue"
          />
          <OutputBox
            label={modelB.label}
            row={results.find((r) => r.modelId === modelB.id && r.scenarioName === activeScenario)}
            accent="amber"
          />
        </div>
      )}
    </div>
  );
}

function NoOutputLabel() {
  const { t } = useTranslation();
  return <span className="text-foreground italic">{t.agents.model_config.no_output}</span>;
}

/**
 * One model's answer for the active scenario — or, when the cell never ran, the
 * reason. On an `error` row the runner copies the error string into
 * `output_preview` (`test_runner/lab.rs:409`), so reading `outputPreview` alone
 * printed the failure as if the model had said it; a `cancelled` row has no
 * preview at all and was indistinguishable from a model that answered nothing.
 */
function OutputBox({
  label,
  row,
  accent,
}: {
  label: string;
  row: LabArenaResult | undefined;
  accent: 'blue' | 'amber';
}) {
  const { t } = useTranslation();
  const borderCls = accent === 'blue' ? 'border-blue-500/20' : 'border-amber-500/20';
  const headerCls = accent === 'blue' ? 'text-blue-400/80' : 'text-amber-400/80';
  const failure = rowFailure(row);
  const text = row?.outputPreview ?? '';
  return (
    <div className={`rounded-modal border ${failure ? 'border-red-500/20' : borderCls} overflow-hidden`}>
      <div
        className={`px-2.5 py-1.5 typo-caption font-medium bg-secondary/30 border-b ${
          failure ? 'text-red-300/90 border-red-500/20' : `${headerCls} ${borderCls}`
        }`}
      >
        {label}
      </div>
      <div className="px-2.5 py-2 typo-code text-foreground max-h-32 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
        {failure ? (
          <>
            {/* `typo-label` carries the weight; adding a `font-*` utility next to
                a typo-* token is silently discarded by the cascade. */}
            <div className="flex items-center gap-1.5 typo-label font-sans text-red-300/90 mb-1">
              <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
              {tokenLabel(t, 'execution', failure.status)}
            </div>
            {failure.message ?? t.common.unknown_error}
          </>
        ) : (
          text || <NoOutputLabel />
        )}
      </div>
    </div>
  );
}
