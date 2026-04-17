import { useState } from 'react';
import {
  Cpu, DollarSign, FlaskConical, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronRight, Target, Layers, Bug, Gauge,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  IntentUseCase,
  IntentModelRecommendation,
  IntentTestScenario,
  IntentCompilationResult,
} from '@/lib/types/designTypes';

// -- Category metadata --------------------------------------------

const CATEGORY_META: Record<string, { Icon: typeof CheckCircle2; text: string; bg: string }> = {
  happy_path:     { Icon: CheckCircle2,  text: 'text-emerald-400', bg: 'bg-emerald-500/12' },
  edge_case:      { Icon: AlertTriangle, text: 'text-amber-400',   bg: 'bg-amber-500/12' },
  error_handling: { Icon: Bug,           text: 'text-red-400',     bg: 'bg-red-500/12' },
  performance:    { Icon: Gauge,         text: 'text-blue-400',    bg: 'bg-blue-500/12' },
};

const COMPLEXITY_COLOR: Record<string, string> = {
  simple:   'text-emerald-400',
  moderate: 'text-amber-400',
  complex:  'text-red-400',
};

// -- Sub-components -----------------------------------------------

function UseCaseCard({ uc }: { uc: IntentUseCase }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/20 rounded-card bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}
        <span className="typo-body font-medium text-foreground/90 flex-1 truncate">{uc.name}</span>
        <span className={`typo-code px-1.5 py-0.5 rounded font-mono ${uc.execution_mode === 'e2e' ? 'bg-emerald-500/12 text-emerald-400' : 'bg-violet-500/12 text-violet-400'}`}>
          {uc.execution_mode}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/10">
          <p className="typo-body text-foreground pt-2">{uc.description}</p>
          {uc.expected_behavior && (
            <div>
              <span className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.design.label_expected}</span>
              <p className="typo-body text-foreground mt-0.5">{uc.expected_behavior}</p>
            </div>
          )}
          {uc.sample_input && Object.keys(uc.sample_input).length > 0 && (
            <div>
              <span className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.design.label_sample_input}</span>
              <pre className="typo-code text-foreground bg-background/40 rounded p-2 mt-0.5 overflow-x-auto font-mono">
                {JSON.stringify(uc.sample_input, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TestScenarioRow({ ts }: { ts: IntentTestScenario }) {
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_META[ts.category] ?? CATEGORY_META.happy_path!;
  const { Icon } = meta;
  return (
    <div className="border border-border/10 rounded-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 text-foreground" /> : <ChevronRight className="w-3 h-3 text-foreground" />}
        <Icon className={`w-3 h-3 ${meta.text}`} />
        <span className="typo-body text-foreground/85 flex-1 truncate">{ts.name}</span>
        <span className={`typo-code px-1.5 py-0.5 rounded ${meta.bg} ${meta.text} font-mono`}>
          {ts.category.replace('_', ' ')}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/10">
          <p className="typo-body text-foreground pt-1.5">{ts.expected_outcome}</p>
          {ts.assertions.length > 0 && (
            <ul className="space-y-0.5">
              {ts.assertions.map((a, i) => (
                <li key={i} className="flex items-start gap-1.5 typo-body text-foreground">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400/60 mt-0.5 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// -- Main component -----------------------------------------------

interface IntentResultExtrasProps {
  result: IntentCompilationResult;
}

export function IntentResultExtras({ result }: IntentResultExtrasProps) {
  const { t } = useTranslation();
  const { use_cases, model_recommendation, test_scenarios, intent_statement } = result;

  // Don't render if no intent-specific data
  if (!use_cases?.length && !model_recommendation && !test_scenarios?.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Intent statement */}
      {intent_statement && (
        <div className="px-3 py-2.5 rounded-modal bg-violet-500/5 border border-violet-500/15">
          <div className="flex items-start gap-2">
            <Target className="w-3.5 h-3.5 text-violet-400/70 mt-0.5 shrink-0" />
            <div>
              <span className="text-sm font-medium text-violet-400/80 uppercase tracking-wider">{t.agents.design.label_intent}</span>
              <p className="text-sm text-foreground/85 mt-0.5">{intent_statement}</p>
            </div>
          </div>
        </div>
      )}

      {/* Model recommendation */}
      {model_recommendation && (
        <ModelRecommendationCard rec={model_recommendation} />
      )}

      {/* Use cases */}
      {use_cases && use_cases.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground/90 tracking-wide">
            <Layers className="w-3.5 h-3.5" />
            {t.agents.design.use_cases_title}
            <span className="text-sm font-mono text-foreground">({use_cases.length})</span>
          </h4>
          <div className="space-y-1.5">
            {use_cases.map((uc) => (
              <UseCaseCard key={uc.id} uc={uc} />
            ))}
          </div>
        </div>
      )}

      {/* Test scenarios */}
      {test_scenarios && test_scenarios.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground/90 tracking-wide">
            <FlaskConical className="w-3.5 h-3.5" />
            {t.agents.design.test_scenarios_title}
            <span className="text-sm font-mono text-foreground">({test_scenarios.length})</span>
          </h4>
          <div className="space-y-1">
            {test_scenarios.map((ts) => (
              <TestScenarioRow key={ts.id} ts={ts} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRecommendationCard({ rec }: { rec: IntentModelRecommendation }) {
  const { t } = useTranslation();
  const complexityColor = COMPLEXITY_COLOR[rec.complexity_level] ?? 'text-foreground';
  return (
    <div className="rounded-modal bg-secondary/30 border border-primary/10 p-3 space-y-2">
      <h4 className="flex items-center gap-2 typo-heading font-semibold text-foreground/90">
        <Cpu className="w-3.5 h-3.5" />
        {t.agents.design.label_model_recommendation}
      </h4>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className="typo-body text-foreground uppercase tracking-wider">{t.agents.design.label_model}</span>
          <p className="typo-body font-medium text-foreground/90 capitalize mt-0.5">{rec.recommended_model}</p>
        </div>
        <div>
          <span className="typo-body text-foreground uppercase tracking-wider">{t.agents.design.label_est_cost_run}</span>
          <p className="typo-code font-mono text-foreground/90 mt-0.5 flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-emerald-400/70" />
            {rec.estimated_cost_per_run_usd.toFixed(3)}
          </p>
        </div>
        <div>
          <span className="typo-body text-foreground uppercase tracking-wider">{t.agents.design.label_complexity}</span>
          <p className={`typo-body font-medium capitalize mt-0.5 ${complexityColor}`}>{rec.complexity_level}</p>
        </div>
      </div>
      <p className="typo-body text-foreground">{rec.reasoning}</p>
    </div>
  );
}
