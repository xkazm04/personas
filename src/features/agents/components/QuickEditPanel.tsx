import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, Check, ChevronDown, Save, X } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { getAllModels } from '@/lib/models/modelCatalog';
import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';

interface QuickEditPanelProps {
  persona: Persona;
  onSave: (id: string, updates: { description?: string; model?: string }) => void;
  onCancel: () => void;
}

/**
 * Quick-edit's model field is a CATALOG PICKER, not free text.
 *
 * It used to be an `<input>` whose trimmed contents were saved verbatim, from
 * the fastest edit surface in the app (the command palette). A typo, or an id
 * that was valid last release - `claude-opus-4-8` after opus-5 shipped - saved
 * silently and pinned the persona to a model that does not resolve, which is
 * the stale-id class that has already cost fleet spend. The rest of the app
 * resolves models through the catalog; this surface now does too.
 *
 * A persona already carrying an id the catalog does not know is NOT rewritten:
 * it is shown, selected, and flagged. Quiet correction would hide a real
 * configuration from the person best placed to fix it - but the only value
 * this panel can now WRITE is a catalog one.
 */

/** Parse the model name out of a model_profile JSON string. */
function parseModelName(json: string | null | undefined): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json);
    return parsed.model ?? '';
  } catch {
    return '';
  }
}

export function QuickEditPanel({ persona, onSave, onCancel }: QuickEditPanelProps) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(persona.description ?? '');
  const [model, setModel] = useState(() => parseModelName(persona.model_profile));
  const descRef = useRef<HTMLTextAreaElement>(null);

  const models = useMemo(() => getAllModels(t), [t]);
  // Match on the catalog's `model` (what gets saved) and on its `id`, because
  // a persona profile can legitimately carry either spelling.
  const selected = useMemo(
    () => models.find((m) => m.model === model || m.id === model) ?? null,
    [models, model],
  );
  // A non-empty value the catalog does not know: shown and flagged, never
  // silently replaced.
  const unrecognized = model.trim().length > 0 && selected === null;

  useEffect(() => {
    requestAnimationFrame(() => descRef.current?.focus());
  }, []);

  const handleSave = useCallback(() => {
    const updates: { description?: string; model?: string } = {};
    const origDesc = persona.description ?? '';
    const origModel = parseModelName(persona.model_profile);

    if (description.trim() !== origDesc) updates.description = description.trim();
    if (model.trim() !== origModel) updates.model = model.trim();

    if (Object.keys(updates).length > 0) {
      onSave(persona.id, updates);
    } else {
      onCancel();
    }
  }, [description, model, persona, onSave, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  }, [onCancel, handleSave]);

  return (
    <div className="px-4 py-3 space-y-3" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <PersonaIcon icon={persona.icon} color={persona.color} size="w-4 h-4" className="shrink-0" frameSize={"lg"} />
        <span className="typo-body font-medium text-foreground truncate">{persona.name}</span>
        <span className="typo-caption text-foreground">{t.common.quick_edit}</span>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-foreground">
          {t.common.description_label}
        </label>
        <textarea
          ref={descRef}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg bg-secondary/30 border border-primary/10 px-3 py-2 typo-body text-foreground placeholder:text-foreground outline-none focus:border-violet-400/50 resize-none transition-colors"
          placeholder={t.common.agent_description_placeholder}
        />
      </div>

      {/* Model */}
      <div className="space-y-1">
        <span
          id={`quick-edit-model-label-${persona.id}`}
          className="text-[11px] font-medium uppercase tracking-wider text-foreground block"
        >
          {t.common.model_label}
        </span>
        <Listbox
          ariaLabel={t.common.model_label}
          itemCount={models.length}
          portal
          onSelectFocused={(i) => {
            const next = models[i];
            if (next) setModel(next.model ?? next.id);
          }}
          renderTrigger={({ isOpen, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={isOpen}
              aria-labelledby={`quick-edit-model-label-${persona.id}`}
              data-testid="quick-edit-model-trigger"
              className="flex items-center gap-2 w-full rounded-card bg-secondary/30 border border-primary/10 px-3 py-2 typo-body text-foreground outline-none focus:border-violet-400/50 transition-colors"
            >
              {unrecognized && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
              <span className="flex-1 text-left truncate">
                {selected?.label ?? (model || t.shared.use_cases_extra.model_placeholder)}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        >
          {({ close }) => (
            <div className="py-1 min-w-[12rem]">
              {models.map((option) => {
                const value = option.model ?? option.id;
                const active = value === model || option.id === model;
                return (
                  <button
                    type="button"
                    key={option.id}
                    role="option"
                    aria-selected={active}
                    data-testid={`quick-edit-model-option-${option.id}`}
                    onClick={() => {
                      setModel(value);
                      close();
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 typo-body transition-colors hover:bg-secondary/40 ${
                      active ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    <span className="flex-1 text-left truncate">{option.label}</span>
                    {active && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </Listbox>
        {unrecognized && (
          <p className="typo-caption text-amber-400" data-testid="quick-edit-model-unrecognized">
            {t.common.model_not_in_catalog}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <span className="typo-caption text-foreground">
          <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">{t.shared.use_cases_extra.ctrl_enter}</kbd>
          {' '}{t.common.save}
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-secondary/50 border border-primary/10 rounded text-[10px]">Esc</kbd>
          {' '}{t.common.cancel}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption text-foreground hover:bg-secondary/40 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption text-foreground bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/30 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {t.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}
