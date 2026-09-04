import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { JsonValue } from '@/lib/bindings/serde_json/JsonValue';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import {
  charterInputFields,
  charterParameterValues,
  sameValue,
  specWithParameterValues,
} from '../libs/charterSpec';
import { CharterParameterField } from './CharterParameterField';
import type { CharterPatch } from './sigil/dimEditorShell';

interface CharterParametersCardProps {
  charter: PersonaResponsibility;
  onPatch: (patch: CharterPatch) => Promise<void>;
}

/**
 * The charter's own `{{param.*}}` knobs — the surface that absorbed the retired
 * persona-level Parameters tab.
 *
 * `spec.inputSchema` declares them (migrated verbatim from the legacy use
 * case's `input_schema`); the VALUES persist to `spec.sampleInput` through
 * `update_persona_responsibility`. See `charterSpec.ts` for why that column and
 * not the persona-wide `parameters` bag.
 */
export function CharterParametersCard({ charter, onPatch }: CharterParametersCardProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const fields = useMemo(() => charterInputFields(charter), [charter]);
  const saved = useMemo(() => charterParameterValues(charter), [charter]);
  // INVARIANT: `spec.sampleInput` and a field's `default` are DB-stored JSON,
  // so their runtime type is whatever wrote the row. Every control renders
  // through `String(...)` / `=== true` and every write goes back through
  // `coerceParameterValue`, so an unexpected shape degrades to an editable
  // string rather than reaching the wire untouched — which is what makes the
  // widening to `JsonValue` safe here.
  const initial = (f: (typeof fields)[number]): JsonValue => (saved[f.key] ?? f.default ?? '') as JsonValue;
  const [draft, setDraft] = useState<Record<string, JsonValue>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initial(f)])),
  );

  const dirty = fields.some((f) => !sameValue(draft[f.key], initial(f)));

  if (fields.length === 0) {
    return (
      <SectionCard title={c.parameters_title}>
        <div data-testid="resp-params-empty">
          <EmptyState title={c.parameters_empty_title} description={c.parameters_empty_body} />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={c.parameters_title}>
      <div className="space-y-3" data-testid="resp-params">
        <p className="typo-caption text-foreground">{c.parameters_hint}</p>
        {fields.map((f) => (
          <CharterParameterField
            key={f.key}
            field={f}
            value={draft[f.key] ?? null}
            onChange={(next) => setDraft((d) => ({ ...d, [f.key]: next }))}
          />
        ))}
        <div className="flex justify-end">
          <AsyncButton
            size="xs"
            variant="primary"
            disabled={!dirty}
            onClick={() => onPatch({ spec: specWithParameterValues(charter.spec, draft) })}
            data-testid="resp-params-save"
          >
            {t.common.save}
          </AsyncButton>
        </div>
      </div>
    </SectionCard>
  );
}
