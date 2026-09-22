// Declaring or editing one branch. The floor only appears for `must_hold`,
// because it is the only scope a floor can fail.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { SCENARIO_SCOPES } from '@/api/devTools/features';
import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';

import { scopeLabel, type TFeatures } from '../featuresModel';
import { SCENARIO_DEFAULT_FLOOR } from '@/api/devTools/features';

export interface ScenarioFormProps {
  useCaseId: string;
  /** Null creates. */
  scenario: BoardScenario | null;
  onSubmit: (input: UpsertScenarioInput) => Promise<void>;
  onClose: () => void;
  t: TFeatures;
  tCommon: { save: string; cancel: string };
}

type AxisRow = { key: string; value: string };

export function ScenarioForm({ useCaseId, scenario, onSubmit, onClose, t, tCommon }: ScenarioFormProps) {
  const [title, setTitle] = useState(scenario?.title ?? '');
  const [scope, setScope] = useState(scenario?.scope ?? 'must_hold');
  const [floor, setFloor] = useState(String(scenario?.floor ?? SCENARIO_DEFAULT_FLOOR));
  const [axes, setAxes] = useState<AxisRow[]>(
    Object.entries(scenario?.axes ?? {}).map(([key, value]) => ({ key, value: value ?? '' })),
  );

  const submit = async () => {
    const map: Record<string, string> = {};
    for (const row of axes) {
      const key = row.key.trim();
      if (key) map[key] = row.value.trim();
    }
    const parsed = Number.parseFloat(floor);
    await onSubmit({
      id: scenario?.id ?? null,
      useCaseId,
      slug: scenario?.slug ?? null,
      title: title.trim(),
      axes: map,
      scope,
      // A floor is stored only where it can be applied; anywhere else the
      // resolved default stands and a stored copy would be a second answer.
      floor: scope === 'must_hold' && Number.isFinite(parsed) ? parsed : null,
    });
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="features-scenario-form" size="md">
      <div className="flex flex-col gap-4 p-5">
        <h2 id="features-scenario-form" className="typo-heading-lg text-foreground">
          {scenario ? t.scenario_form_edit : t.scenario_form_new}
        </h2>

        <FormField label={t.field_title} helpText={t.field_title_hint} required value={title}>
          {(input) => (
            <input
              {...input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-input border border-border bg-secondary/40 px-2.5 py-1.5 typo-body text-foreground outline-none focus-ring"
            />
          )}
        </FormField>

        <div>
          <p className="typo-title">{t.field_axes}</p>
          <p className="typo-caption">{t.field_axes_hint}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {axes.map((row, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <input
                  value={row.key}
                  aria-label={t.field_axis_name}
                  placeholder={t.field_axis_name}
                  onChange={(e) => setAxes((prev) => prev.map((r, k) => (k === i ? { ...r, key: e.target.value } : r)))}
                  className="min-w-0 flex-1 rounded-input border border-border bg-secondary/40 px-2 py-1 typo-body text-foreground outline-none focus-ring"
                />
                <input
                  value={row.value}
                  aria-label={t.field_axis_value}
                  placeholder={t.field_axis_value}
                  onChange={(e) => setAxes((prev) => prev.map((r, k) => (k === i ? { ...r, value: e.target.value } : r)))}
                  className="min-w-0 flex-1 rounded-input border border-border bg-secondary/40 px-2 py-1 typo-body text-foreground outline-none focus-ring"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t.field_axis_remove}
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => setAxes((prev) => prev.filter((_, k) => k !== i))}
                />
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAxes((prev) => [...prev, { key: '', value: '' }])}
            className="mt-1.5"
          >
            {t.field_axis_add}
          </Button>
        </div>

        <div>
          <p className="typo-title">{t.field_scope}</p>
          <Listbox
            ariaLabel={t.field_scope}
            renderTrigger={({ toggle }) => (
              <Button variant="secondary" size="sm" onClick={toggle} data-testid="features-scope-trigger">
                {scopeLabel(scope, t)}
              </Button>
            )}
          >
            {({ close }) => (
              <ul>
                {SCENARIO_SCOPES.map((option) => (
                  <li key={option}>
                    <button
                      type="button"
                      onClick={() => { setScope(option); close(); }}
                      className="w-full rounded-interactive px-2 py-1.5 text-left typo-body text-foreground hover:bg-secondary/60 focus-ring"
                    >
                      {scopeLabel(option, t)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Listbox>
        </div>

        {scope === 'must_hold' ? (
          <FormField label={t.field_floor} helpText={t.field_floor_hint} value={floor}>
            {(input) => (
              <input
                {...input}
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                className="w-28 rounded-input border border-border bg-secondary/40 px-2.5 py-1.5 typo-body text-foreground outline-none focus-ring"
              />
            )}
          </FormField>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{tCommon.cancel}</Button>
          <AsyncButton variant="primary" onClick={submit} disabled={title.trim().length === 0}>
            {tCommon.save}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
