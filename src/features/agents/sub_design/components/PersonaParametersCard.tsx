import { useCallback, useMemo, useState } from 'react';
import { Sliders, RotateCcw, Check } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { updatePersonaParameters } from '@/api/agents/personaParameters';
import { toastCatch } from '@/lib/silentCatch';
import type { PersonaParameter } from '@/lib/bindings/PersonaParameter';
import { DebtText, debtText } from '@/i18n/DebtText';
import { useTranslation } from '@/i18n/useTranslation';


/**
 * Live editor for the persona's free parameters. Reads `selectedPersona.parameters`
 * (JSON string in the DB column), renders one row per parameter with a
 * type-appropriate editor, and persists every change via
 * `update_persona_parameters` — which the runtime layer
 * (`engine/prompt/variables.rs`) substitutes into `{{param.KEY}}` placeholders
 * on every execution, with no rebuild required.
 *
 * The card hides itself entirely when the persona declares no parameters,
 * so it costs zero screen real estate on personas that aren't tunable.
 */
export function PersonaParametersCard() {
  const { t } = useTranslation();
  const labels = t.agents.parameters_card;
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  // Parse the JSON column once per persona/string identity. Drops silently on
  // a parse failure — corrupt parameters wouldn't render usefully anyway and
  // the persona itself is still functional.
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

  // Local draft tracks edits while the user is typing — only committed to the
  // DB on blur / explicit save so we don't fire an IPC per keystroke.
  const [drafts, setDrafts] = useState<Record<string, PersonaParameter['value']>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const handleDraft = useCallback((key: string, value: PersonaParameter['value']) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const commit = useCallback(
    async (param: PersonaParameter, nextValue: PersonaParameter['value']) => {
      if (!selectedPersona) return;
      // Persist by serializing the entire parameters array with the one
      // entry's value swapped — keeps the column shape consistent and
      // sidesteps a partial-update IPC.
      const next = parameters.map((p) => (p.key === param.key ? { ...p, value: nextValue } : p));
      setSavingKey(param.key);
      try {
        await updatePersonaParameters(selectedPersona.id, JSON.stringify(next));
        await fetchPersonas();
        setDrafts((prev) => {
          const { [param.key]: _, ...rest } = prev;
          return rest;
        });
        setSavedKey(param.key);
        window.setTimeout(() => {
          setSavedKey((cur) => (cur === param.key ? null : cur));
        }, 1500);
      } catch (err) {
        toastCatch('PersonaParametersCard:commit', 'Failed to save parameter')(err);
      } finally {
        setSavingKey((cur) => (cur === param.key ? null : cur));
      }
    },
    [parameters, fetchPersonas, selectedPersona],
  );

  const reset = useCallback(
    (param: PersonaParameter) => {
      handleDraft(param.key, param.default_value);
      void commit(param, param.default_value);
    },
    [commit, handleDraft],
  );

  if (!selectedPersona || parameters.length === 0) return null;

  return (
    <section className="rounded-card border border-card-border bg-card-bg p-4 shadow-elevation-1 mb-3">
      <header className="flex items-center gap-2 mb-3">
        <Sliders className="w-4 h-4 text-primary/80" />
        <h3 className="typo-section-title text-foreground">{labels.title}</h3>
        <span className="typo-caption text-foreground ml-2">
          <DebtText k="auto_adjustable_without_rebuild_72b22655" />
        </span>
      </header>
      <div className="flex flex-col gap-3">
        {parameters.map((param) => {
          const current = drafts[param.key] ?? param.value;
          const isSaving = savingKey === param.key;
          const isSaved = savedKey === param.key;
          const isDirty =
            drafts[param.key] !== undefined &&
            JSON.stringify(drafts[param.key]) !== JSON.stringify(param.value);
          const isDefault =
            JSON.stringify(param.value) === JSON.stringify(param.default_value);
          return (
            <div
              key={param.key}
              className="flex flex-col gap-1.5 rounded-input border border-card-border bg-secondary/10 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <label
                  htmlFor={`param-${param.key}`}
                  className="typo-label font-semibold text-foreground"
                >
                  {param.label}
                </label>
                {param.unit && (
                  <span className="typo-caption text-foreground">({param.unit})</span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  {isSaving && (
                    <span className="typo-caption text-foreground"><DebtText k="auto_saving_56a2285c" /></span>
                  )}
                  {isSaved && !isSaving && (
                    <span className="inline-flex items-center gap-1 typo-caption text-status-success">
                      <Check className="w-3 h-3" /> {labels.saved}
                    </span>
                  )}
                  {!isDefault && !isSaving && !isSaved && (
                    <button
                      type="button"
                      onClick={() => reset(param)}
                      className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground cursor-pointer transition-colors"
                      title={debtText("auto_reset_to_default_39c90eb7")}
                    >
                      <RotateCcw className="w-3 h-3" /> {labels.reset}
                    </button>
                  )}
                </span>
              </div>
              <ParameterEditor
                param={param}
                value={current}
                onDraft={(v) => handleDraft(param.key, v)}
                onCommit={(v) => void commit(param, v)}
              />
              {param.description && (
                <p className="typo-caption text-foreground leading-snug">
                  {param.description}
                </p>
              )}
              {isDirty && (
                <button
                  type="button"
                  onClick={() => void commit(param, current)}
                  className="self-end px-2.5 py-1 rounded-interactive bg-primary/15 border border-primary/30 hover:bg-primary/25 typo-caption font-semibold text-foreground cursor-pointer transition-colors"
                >
                  {labels.apply}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ParameterEditor({
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
      return (
        <div className="flex items-center gap-3">
          <input
            id={inputId}
            type="range"
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={1}
            value={n}
            onChange={(e) => onDraft(Number(e.target.value))}
            onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
            className="flex-1 accent-primary"
          />
          <input
            type="number"
            value={n}
            min={param.min ?? undefined}
            max={param.max ?? undefined}
            onChange={(e) => onDraft(Number(e.target.value))}
            onBlur={(e) => onCommit(Number(e.target.value))}
            className="w-20 px-2 py-1 rounded-input border border-card-border bg-card-bg typo-body tabular-nums text-foreground focus:outline-none focus:border-primary/40"
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
          <span
            className={`w-2 h-2 rounded-full ${
              b ? 'bg-status-success' : 'bg-foreground/30'
            }`}
          />
          {b ? t.agents.parameters_card.on : t.agents.parameters_card.off}
        </button>
      );
    }
    case 'select': {
      const s = typeof value === 'string' ? value : String(value ?? '');
      const opts = param.options ?? [];
      return (
        <select
          id={inputId}
          value={s}
          onChange={(e) => onCommit(e.target.value)}
          className="px-2 py-1.5 rounded-input border border-card-border bg-card-bg typo-body text-foreground focus:outline-none focus:border-primary/40 cursor-pointer"
        >
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
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
          className="w-full px-2 py-1.5 rounded-input border border-card-border bg-card-bg typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
          placeholder={
            typeof param.default_value === 'string' ? param.default_value : undefined
          }
        />
      );
    }
  }
}
