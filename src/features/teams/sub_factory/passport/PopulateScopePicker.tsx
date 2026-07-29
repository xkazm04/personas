// Lane picker for the "Populate project data" consent modal.
//
// The action used to be all-or-nothing, which meant a project needing only KPI
// triage still paid for two scans it did not need. Each lane is independently
// selectable, and the default selection comes from the freshness gates — a
// project whose contexts and features are current opens with just KPIs ticked,
// so the common case is confirm-and-go rather than three deselections.
//
// Each row states what the lane would ACTUALLY do for THIS project (from the
// gates), not what the lane is in the abstract. "Context map: 12 groups and
// current, will be left alone" is the sentence that lets someone uncheck it
// with confidence.
import { Check } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { PopulateGates, PopulateLane } from './populateDispatch';
import { POPULATE_LANES, describeGates } from './populateDispatch';

export function PopulateScopePicker({ gates, lanes, onChange }: {
  gates: PopulateGates;
  lanes: PopulateLane[];
  onChange: (next: PopulateLane[]) => void;
}) {
  const { t } = useTranslation();
  const [contextsLine, featuresLine, kpisLine] = describeGates(gates);

  const meta: Record<PopulateLane, { label: string; detail: string }> = {
    contexts: { label: t.kpis.populate_lane_contexts, detail: contextsLine },
    features: { label: t.kpis.populate_lane_features, detail: featuresLine },
    kpis: { label: t.kpis.populate_lane_kpis, detail: kpisLine },
    simulation: {
      label: t.kpis.populate_lane_simulation,
      detail: t.kpis.populate_lane_simulation_detail,
    },
  };

  const toggle = (lane: PopulateLane) => {
    onChange(lanes.includes(lane) ? lanes.filter((l) => l !== lane) : [...lanes, lane]);
  };

  return (
    <section data-testid="populate-scope-picker">
      <h3 className="typo-caption uppercase tracking-[0.08em] text-foreground mb-2">
        {t.kpis.populate_scope_heading}
      </h3>
      <div className="grid sm:grid-cols-2 gap-2" role="group" aria-label={t.kpis.populate_scope_heading}>
        {POPULATE_LANES.map((lane) => {
          const on = lanes.includes(lane);
          const m = meta[lane];
          return (
            <button
              key={lane}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(lane)}
              className={`flex items-start gap-2.5 rounded-card border px-3 py-2 text-left transition-colors focus-ring ${
                on ? 'border-primary/50 bg-primary/[0.07]' : 'border-foreground/[0.1] hover:bg-foreground/[0.03]'
              }`}
              data-testid={`populate-lane-${lane}`}
            >
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-input shrink-0 mt-px border ${
                  on ? 'bg-primary/20 border-primary/50' : 'border-foreground/20'
                }`}
                aria-hidden
              >
                {on ? <Check className="w-3.5 h-3.5 text-primary" /> : null}
              </span>
              <span className="min-w-0">
                <span className={`typo-body-lg font-medium block ${on ? 'text-foreground' : 'text-foreground/75'}`}>
                  {m.label}
                </span>
                <span className="typo-caption block leading-snug text-foreground">{m.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {lanes.length === 0 && (
        <p className="typo-caption text-status-warning mt-2" data-testid="populate-scope-empty">
          {t.kpis.populate_scope_empty}
        </p>
      )}
    </section>
  );
}
