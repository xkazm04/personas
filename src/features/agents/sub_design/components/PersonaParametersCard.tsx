import { Sliders, Info } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DebtText } from '@/i18n/DebtText';
import { useTranslation } from '@/i18n/useTranslation';
import { useParameterEditing, ParameterEditor, ParamStatus } from './parameterEditing';

/**
 * Live editor for the persona's free parameters (the `{{param.KEY}}` values the
 * runtime substitutes per execution — no rebuild required).
 *
 * Layout: a dense two-column "ledger" spec sheet — label + unit on the left
 * (the optional description tucked behind an info-icon tooltip to keep rows
 * compact), the editor right-aligned. Promoted from the `/prototype` "Ledger"
 * variant (2026-06-18); the Grid + the original full-width-row baseline were
 * retired at consolidation.
 */
export function PersonaParametersCard() {
  const { t } = useTranslation();
  const labels = t.agents.parameters_card;
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const { parameters, handleDraft, commit, reset, rowState } = useParameterEditing();

  if (!selectedPersona || parameters.length === 0) {
    return (
      <div className="py-10">
        <EmptyState icon={Sliders} title={labels.title} />
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <Sliders className="w-4 h-4 text-primary/80" />
        <h3 className="typo-section-title text-foreground">{labels.title}</h3>
        <span className="typo-caption ml-1">
          <DebtText k="auto_adjustable_without_rebuild_72b22655" />
        </span>
      </header>

      <div className="grid md:grid-cols-2 gap-x-8 gap-y-0 rounded-modal border border-primary/10 bg-secondary/20 px-4 py-1">
        {parameters.map((param) => {
          const st = rowState(param);
          return (
            <div
              key={param.key}
              className="flex items-start justify-between gap-4 py-3 border-b border-primary/[0.07] last:border-b-0"
            >
              <div className="min-w-0 flex-1 pt-1 flex items-center gap-1.5">
                <label
                  htmlFor={`param-${param.key}`}
                  className="typo-label font-semibold text-foreground truncate"
                >
                  {param.label}
                </label>
                {param.unit && <span className="typo-caption flex-shrink-0">{param.unit}</span>}
                {param.description && (
                  <Tooltip content={param.description} placement="top">
                    <span className="flex-shrink-0 inline-flex text-primary/70 hover:text-primary cursor-help transition-colors">
                      <Info className="w-3.5 h-3.5" />
                    </span>
                  </Tooltip>
                )}
              </div>

              <div className="w-[56%] max-w-[340px] flex-shrink-0 flex flex-col items-stretch gap-1">
                <ParameterEditor
                  param={param}
                  value={st.current}
                  onDraft={(v) => handleDraft(param.key, v)}
                  onCommit={(v) => commit(param, v)}
                />
                <div className="flex items-center justify-end gap-2 min-h-[1.1rem]">
                  {st.isDirty && (
                    <button
                      type="button"
                      onClick={() => commit(param, st.current)}
                      className="px-2.5 py-0.5 rounded-interactive bg-primary/15 border border-primary/30 hover:bg-primary/25 typo-caption font-semibold text-foreground cursor-pointer transition-colors"
                    >
                      {labels.apply}
                    </button>
                  )}
                  <ParamStatus state={st} onReset={() => reset(param)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
