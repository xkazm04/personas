import { useCallback, useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { updatePersonaParameters } from '@/api/agents/personaParameters';
import { toastCatch } from '@/lib/silentCatch';
import type { PersonaParameter } from '@/lib/bindings/PersonaParameter';
import { DebtText, debtText } from '@/i18n/DebtText';
import { useTranslation } from '@/i18n/useTranslation';
import { Slider } from '@/features/shared/components/forms/Slider';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

/**
 * Shared parameter-editing core for the Parameters subtab and its prototype
 * variants. Owns the parse → draft → commit (one IPC on release/blur) →
 * fetch flow so each layout variant only renders the chrome, never the logic.
 */

export interface ParamRowState {
  current: PersonaParameter['value'];
  isSaving: boolean;
  isSaved: boolean;
  isDirty: boolean;
  isDefault: boolean;
}

export interface ParameterEditing {
  parameters: PersonaParameter[];
  handleDraft: (key: string, value: PersonaParameter['value']) => void;
  commit: (param: PersonaParameter, nextValue: PersonaParameter['value']) => void;
  reset: (param: PersonaParameter) => void;
  rowState: (param: PersonaParameter) => ParamRowState;
}

export function useParameterEditing(): ParameterEditing {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  const parameters = useMemo<PersonaParameter[]>(() => {
    const raw = selectedPersona?.parameters;
    if (!raw || typeof raw !== 'string') return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }, [selectedPersona?.parameters]);

  const [drafts, setDrafts] = useState<Record<string, PersonaParameter['value']>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const handleDraft = useCallback((key: string, value: PersonaParameter['value']) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const commit = useCallback(
    (param: PersonaParameter, nextValue: PersonaParameter['value']) => {
      if (!selectedPersona) return;
      const next = parameters.map((p) => (p.key === param.key ? { ...p, value: nextValue } : p));
      setSavingKey(param.key);
      void (async () => {
        try {
          await updatePersonaParameters(selectedPersona.id, JSON.stringify(next));
          await fetchPersonas();
          setDrafts((prev) => {
            const { [param.key]: _drop, ...rest } = prev;
            return rest;
          });
          setSavedKey(param.key);
          window.setTimeout(() => setSavedKey((cur) => (cur === param.key ? null : cur)), 1500);
        } catch (err) {
          toastCatch('PersonaParametersCard:commit', 'Failed to save parameter')(err);
        } finally {
          setSavingKey((cur) => (cur === param.key ? null : cur));
        }
      })();
    },
    [parameters, fetchPersonas, selectedPersona],
  );

  const reset = useCallback(
    (param: PersonaParameter) => {
      handleDraft(param.key, param.default_value);
      commit(param, param.default_value);
    },
    [commit, handleDraft],
  );

  const rowState = useCallback(
    (param: PersonaParameter): ParamRowState => {
      const current = drafts[param.key] ?? param.value;
      return {
        current,
        isSaving: savingKey === param.key,
        isSaved: savedKey === param.key,
        isDirty:
          drafts[param.key] !== undefined &&
          JSON.stringify(drafts[param.key]) !== JSON.stringify(param.value),
        isDefault: JSON.stringify(param.value) === JSON.stringify(param.default_value),
      };
    },
    [drafts, savingKey, savedKey],
  );

  return { parameters, handleDraft, commit, reset, rowState };
}

/** Saving / Saved / Reset-to-default affordance, shared across layouts. */
export function ParamStatus({ state, onReset }: { state: ParamRowState; onReset: () => void }) {
  const { t } = useTranslation();
  const labels = t.agents.parameters_card;
  if (state.isSaving) {
    return <span className="typo-caption text-foreground"><DebtText k="auto_saving_56a2285c" /></span>;
  }
  if (state.isSaved) {
    return (
      <span className="inline-flex items-center gap-1 typo-caption text-status-success">
        <Check className="w-3 h-3" /> {labels.saved}
      </span>
    );
  }
  if (!state.isDefault) {
    return (
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground cursor-pointer transition-colors"
        title={debtText('auto_reset_to_default_39c90eb7')}
      >
        <RotateCcw className="w-3 h-3" /> {labels.reset}
      </button>
    );
  }
  return null;
}

/**
 * Type-appropriate editor for a single parameter. `onDraft` keeps the live
 * preview; `onCommit` persists (one IPC) on slider-release / stepper-blur /
 * toggle / select.
 */
export function ParameterEditor({
  param,
  value,
  onDraft,
  onCommit,
}: {
  param: PersonaParameter;
  value: PersonaParameter['value'];
  onDraft: (v: PersonaParameter['value']) => void;
  onCommit: (v: PersonaParameter['value']) => void;
}) {
  const { t } = useTranslation();
  const inputId = `param-${param.key}`;
  switch (param.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value) || 0;
      // Value input on top, slider underneath — keeps each ledger row compact
      // in its constrained right column (per the consolidation adjustment).
      return (
        <div className="flex flex-col items-start gap-2">
          <NumberStepper
            value={n}
            min={param.min ?? undefined}
            max={param.max ?? undefined}
            onChange={(v) => onDraft(v ?? (param.min ?? 0))}
            onCommit={(v) => onCommit(v ?? (param.min ?? 0))}
            ariaLabel={param.label}
          />
          <Slider
            id={inputId}
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={1}
            value={n}
            onChange={(v) => onDraft(v)}
            onCommit={(v) => onCommit(v)}
            ariaLabel={param.label}
            className="w-full"
          />
        </div>
      );
    }
    case 'boolean': {
      const b = !!value;
      return (
        <button
          id={inputId}
          type="button"
          onClick={() => onCommit(!b)}
          className={`self-start inline-flex items-center gap-2 px-3 py-1.5 rounded-interactive border typo-label font-medium cursor-pointer transition-colors ${
            b
              ? 'bg-status-success/15 border-status-success/30 text-status-success'
              : 'bg-foreground/[0.04] border-card-border text-foreground hover:bg-foreground/[0.07]'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${b ? 'bg-status-success' : 'bg-foreground/30'}`} />
          {b ? t.agents.parameters_card.on : t.agents.parameters_card.off}
        </button>
      );
    }
    case 'select': {
      const s = typeof value === 'string' ? value : String(value ?? '');
      const opts = param.options ?? [];
      // Shared ThemedSelect (filterable + hideSearch) renders app-themed option
      // rows instead of OS-styled native <option>s — see CATALOG.md "Listbox /
      // ThemedSelect: use instead of raw <select>".
      return (
        <ThemedSelect
          filterable
          hideSearch
          options={opts.map((opt) => ({ value: opt, label: opt }))}
          value={s}
          onValueChange={(v) => onCommit(v)}
          aria-label={param.label}
        />
      );
    }
    case 'string':
    default: {
      const s = typeof value === 'string' ? value : String(value ?? '');
      return (
        <input
          id={inputId}
          type="text"
          value={s}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          className={INPUT_FIELD}
          placeholder={typeof param.default_value === 'string' ? param.default_value : undefined}
        />
      );
    }
  }
}
