// The nested layer: a feature certified as a whole, branch by branch.
//
// The ENVELOPE above the cells is RENDERED FROM THE BOARD and never recomputed
// here. `aggregate_scenarios` folds it on the Rust side with the same rule set
// the /council skill uses, so the page cannot show a second answer; when the
// board carries no envelope the panel says nothing has been measured rather
// than folding one of its own.
import { useState } from 'react';
import { Plus } from 'lucide-react';

import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';
import { AsyncButton } from '@/features/shared/components/buttons';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';

import { hasAdvisory, worstInScope } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import { ScenarioCell } from './ScenarioCell';
import { ScenarioForm } from './ScenarioForm';

export interface ScenariosPanelProps {
  feature: BoardFeature;
  onUpsert: (input: UpsertScenarioInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  t: TFeatures;
  tCommon: { save: string; cancel: string; delete: string };
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

export function ScenariosPanel({
  feature,
  onUpsert,
  onDelete,
  t,
  tCommon,
  tx,
  language,
}: ScenariosPanelProps) {
  const [editing, setEditing] = useState<BoardScenario | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BoardScenario | null>(null);

  const declared = feature.scenarios.filter((s) => s.scope !== 'proposed');
  const proposed = feature.scenarios.filter((s) => s.scope === 'proposed');
  const envelope = feature.envelope;
  const worst = worstInScope(feature.scenarios);

  return (
    <section className="rounded-card border border-primary/15 bg-primary/5 shadow-elevation-1 p-4" data-testid="features-scenarios">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="typo-body-lg text-foreground">{t.scenarios_title}</h3>
          <p className="mt-0.5 max-w-prose typo-caption">{t.scenarios_subtitle}</p>
        </div>
        <AsyncButton
          variant="secondary"
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setCreating(true)}
          data-testid="features-scenario-add"
        >
          {t.scenario_add}
        </AsyncButton>
      </div>

      {/* The envelope, in one drawn line. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="features-envelope">
        {envelope == null ? (
          <p className="typo-caption">{t.envelope_none}</p>
        ) : (
          <>
            <span className="typo-caption text-foreground">{t.envelope_label}</span>
            <span className="rounded-pill border border-status-success/50 px-2 py-0.5 typo-caption text-status-success">
              {tx(t.envelope_holds, { count: envelope.holds.length })}
            </span>
            <span className="rounded-pill border border-status-error/50 px-2 py-0.5 typo-caption text-status-error">
              {tx(t.envelope_weak, { count: envelope.weak.length })}
            </span>
            <span className="rounded-pill border border-border px-2 py-0.5 typo-caption text-foreground">
              {tx(t.envelope_unmeasured, { count: envelope.unmeasured.length })}
            </span>
            <span className="rounded-pill border border-border px-2 py-0.5 typo-caption text-foreground">
              {tx(t.envelope_out_of_scope, { count: envelope.outOfScope.length })}
            </span>
            {worst ? (
              <span className="typo-caption text-foreground">{tx(t.envelope_worst, { name: worst.title })}</span>
            ) : null}
          </>
        )}
      </div>

      {/* Said ONCE for the panel, not repeated on every cell. */}
      {hasAdvisory(feature.scenarios) ? (
        <p className="mt-2 max-w-prose typo-caption text-status-warning">{t.advisory_note}</p>
      ) : null}

      {declared.length === 0 ? (
        <div className="mt-3">
          <ScenarioEmptyState
            title={t.scenarios_none_title}
            subtitle={t.scenarios_none_subtitle}
            action={{ label: t.scenario_add, onClick: () => setCreating(true) }}
          />
        </div>
      ) : (
        <div className="mt-3 grid max-h-[480px] grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-2.5 overflow-y-auto">
          {declared.map((s) => (
            <ScenarioCell
              key={s.id}
              scenario={s}
              onEdit={setEditing}
              onDelete={setDeleting}
              t={t}
              tx={tx}
              language={language}
            />
          ))}
        </div>
      )}

      {proposed.length > 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-violet-400/50 p-3" data-testid="features-proposed">
          <h4 className="typo-body-lg text-foreground">{t.proposed_title}</h4>
          <p className="mt-0.5 max-w-prose typo-caption">{t.proposed_subtitle}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {proposed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 typo-body text-foreground">{s.title}</span>
                <AsyncButton
                  size="sm"
                  variant="secondary"
                  onClick={() => onUpsert({ id: s.id, useCaseId: feature.id, slug: s.slug, title: s.title, axes: s.axes, scope: 'must_hold', floor: s.floor })}
                >
                  {t.adopt_must_hold}
                </AsyncButton>
                <AsyncButton
                  size="sm"
                  variant="secondary"
                  onClick={() => onUpsert({ id: s.id, useCaseId: feature.id, slug: s.slug, title: s.title, axes: s.axes, scope: 'tracked', floor: null })}
                >
                  {t.adopt_tracked}
                </AsyncButton>
                <AsyncButton
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpsert({ id: s.id, useCaseId: feature.id, slug: s.slug, title: s.title, axes: s.axes, scope: 'out_of_scope', floor: null })}
                >
                  {t.dismiss}
                </AsyncButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(creating || editing) && (
        <ScenarioForm
          useCaseId={feature.id}
          scenario={editing}
          onSubmit={async (input) => {
            await onUpsert(input);
            setCreating(false);
            setEditing(null);
          }}
          onClose={() => { setCreating(false); setEditing(null); }}
          t={t}
          tCommon={tCommon}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t.scenario_delete_title}
          body={t.scenario_delete_body}
          danger
          confirmLabel={tCommon.delete}
          cancelLabel={tCommon.cancel}
          onConfirm={async () => {
            await onDelete(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
