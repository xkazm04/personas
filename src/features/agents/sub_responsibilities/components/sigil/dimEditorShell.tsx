import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { ResponsibilityCadence } from '@/lib/bindings/ResponsibilityCadence';
import type { ResponsibilityOutcome } from '@/lib/bindings/ResponsibilityOutcome';
import type { ResponsibilitySpec } from '@/lib/bindings/ResponsibilitySpec';

/** The charter fields a sigil-dimension editor is allowed to write. */
export interface CharterPatch {
  procedure?: string;
  outcomes?: ResponsibilityOutcome[];
  connectors?: string[];
  approvalGates?: string[];
  cadence?: ResponsibilityCadence;
  spec?: ResponsibilitySpec;
  /** Double-`Option` column on the wire: `null` CLEARS the budget, `undefined`
   *  (absent) leaves it unchanged. See `RESPONSIBILITY_NULLABLE_FIELDS`. */
  budgetMonthlyUsd?: number | null;
}

export interface CharterDimEditorProps {
  charter: PersonaResponsibility;
  /** Persist a partial charter update through `update_persona_responsibility`. */
  onPatch: (patch: CharterPatch) => Promise<void>;
}

/**
 * Chrome shared by every per-dimension charter editor rendered inside
 * `SigilEditModal`'s `body` slot: a caption explaining what the dimension
 * controls, the caller's fields, and one Save affordance.
 *
 * The save is an `AsyncButton` (returns-a-promise `onClick`) rather than a
 * local `useState` + `try/finally` — the repo's inline-busy-state golden path.
 */
export function DimEditorShell({
  caption,
  children,
  dirty,
  onSave,
  testId,
}: {
  caption: string;
  children: ReactNode;
  dirty: boolean;
  onSave: () => Promise<void>;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <p className="typo-caption text-foreground">{caption}</p>
      {children}
      <div className="flex justify-end pt-1">
        <AsyncButton
          size="xs"
          variant="primary"
          disabled={!dirty}
          onClick={onSave}
          data-testid={`${testId}-save`}
        >
          {t.common.save}
        </AsyncButton>
      </div>
    </div>
  );
}

/** Multi-select chip list — the same `aria-pressed` pill affordance the
 *  refusal-class picker uses, so the two editors read as one system. */
export function ChipToggleList({
  options,
  selected,
  onToggle,
  testId,
}: {
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            aria-pressed={active}
            className={`px-2 py-1 rounded-pill border typo-code transition-colors ${
              active
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-secondary/30 border-primary/10 text-foreground/85 hover:border-primary/25'
            }`}
            data-testid={`${testId}-${opt.value}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
