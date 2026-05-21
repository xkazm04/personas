import { useMemo, useState } from 'react';
import { X, Sparkles, AlertTriangle, ExternalLink } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe, BindingValue, RecipeBinding, BindingKind, Eligibility } from '../types';
import { useRecipeEligibility } from '../useEligibility';
import { useAdoption } from '../libs/useAdoption';
import { defaultBindingValues, findMissingBindings } from '../libs/substituteBindings';

interface RecipeAdoptionModalProps {
  recipe: Recipe;
  onClose: () => void;
  /** Called after a successful adoption — typically navigates the user
   *  to the persona's use cases tab so they can see the new capability. */
  onAdopted?: (useCaseId: string) => void;
}

/**
 * Adoption modal — opens when the user clicks "Adopt" on a recipe.
 *
 * Steps:
 *   1. Verify a persona is selected (else show CTA to select one).
 *   2. If `adoptable-with-setup`: show the missing connectors with
 *      pointers to the Vault. Adoption is gated until they're wired —
 *      we don't multi-step inside this modal in v1, just nudge.
 *   3. Render the bindings form. Each binding kind gets a tailored input.
 *   4. On submit: validate required bindings → call `useAdoption.adopt`
 *      → toast + close.
 *
 * Out of scope for v1 (deferred):
 *   - Persona target picker (uses the currently-selected persona only).
 *     Multi-persona adopt-into would be a follow-up.
 *   - Real connector-bound pickers (slack-channel etc.). Today these are
 *     plain text inputs with helpful placeholders. Adding live pickers
 *     for each kind is a Phase 3+ enhancement.
 */
export function RecipeAdoptionModal({ recipe, onClose, onAdopted }: RecipeAdoptionModalProps) {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const eligibility = useRecipeEligibility(recipe);
  const { adopt, pending } = useAdoption();

  const [values, setValues] = useState<Record<string, BindingValue | undefined>>(
    () => defaultBindingValues(recipe.bindings),
  );
  const [showErrors, setShowErrors] = useState(false);

  const missing = useMemo(
    () => findMissingBindings(recipe.bindings, values),
    [recipe.bindings, values],
  );
  const formValid = missing.length === 0;
  const canAdopt = !!selectedPersona && eligibility.state === 'eligible' && formValid;

  const setValue = (key: string, value: BindingValue | undefined) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleAdopt = async () => {
    if (!selectedPersona) return;
    if (!formValid) { setShowErrors(true); return; }
    if (eligibility.state !== 'eligible') return;
    const result = await adopt(selectedPersona.id, recipe, values);
    if (result) {
      onAdopted?.(result.useCaseId);
      onClose();
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="recipe-adoption-title" size="lg" portal>
      <div className="flex flex-col max-h-[80vh] rounded-modal border border-card-border bg-card-bg shadow-elevation-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-3 border-b border-card-border/60 flex-shrink-0">
          <span className="shrink-0 flex items-center justify-center rounded-card mt-0.5"
            style={{ width: 36, height: 36, background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.35)' }}>
            <Sparkles className="w-4 h-4 text-primary" />
          </span>
          <div className="flex-1 min-w-0">
            <div id="recipe-adoption-title" className="typo-section-title text-foreground">
              {tx(t.recipes_catalog.modal_title, { name: recipe.name })}
            </div>
            <div className="typo-caption text-foreground mt-0.5">
              {selectedPersona
                ? <>{tx(t.recipes_catalog.modal_subtitle_persona, { personaName: selectedPersona.name })}</>
                : t.recipes_catalog.modal_subtitle_no_persona}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
            title={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-4">
          {!selectedPersona ? (
            <NoPersonaState onClose={onClose} />
          ) : (
            <>
              {eligibility.state === 'adoptable-with-setup' && (
                <SetupRequiredCallout eligibility={eligibility} />
              )}
              {eligibility.state === 'incompatible' && (
                <IncompatibleCallout eligibility={eligibility} />
              )}

              {/* Bindings form — only render if base eligibility passes the
                  setup gate. We still show the form for adoptable-with-setup
                  so the user can fill values now and adopt later, but the
                  primary CTA stays disabled. */}
              {eligibility.state !== 'incompatible' && recipe.bindings.length > 0 && (
                <div className="space-y-3 mt-1">
                  <div className="typo-label uppercase tracking-wider text-foreground">
                    {tx(recipe.bindings.length === 1 ? t.recipes_catalog.configure_settings_one : t.recipes_catalog.configure_settings_other, { count: recipe.bindings.length })}
                  </div>
                  {recipe.bindings.map((b) => (
                    <BindingField
                      key={b.variable}
                      binding={b}
                      value={values[b.variable]}
                      onChange={(v) => setValue(b.variable, v)}
                      error={showErrors && missing.includes(b.variable)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-card-border/60 flex-shrink-0">
          <span className="typo-caption text-foreground">
            {showErrors && missing.length > 0 && (
              <span className="text-status-warning">
                <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                {tx(missing.length === 1 ? t.recipes_catalog.missing_settings_one : t.recipes_catalog.missing_settings_other, { count: missing.length })}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded-interactive border border-card-border bg-secondary/40 text-foreground/85 hover:border-foreground/40 typo-caption cursor-pointer transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleAdopt}
            disabled={!canAdopt || pending}
            className="px-4 py-1.5 rounded-interactive border border-primary/45 bg-primary/15 text-primary hover:bg-primary/25 typo-body font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {pending ? t.recipes_catalog.adopting_label : t.recipes_catalog.adopt_recipe_label}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NoPersonaState({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-8">
      <div className="typo-body text-foreground/85 mb-1">{t.recipes_catalog.no_persona_heading}</div>
      <div className="typo-caption text-foreground mb-4">
        {t.recipes_catalog.no_persona_body}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-1.5 rounded-interactive border border-card-border bg-secondary/40 text-foreground/85 hover:border-foreground/40 typo-caption cursor-pointer transition-colors"
      >
        {t.common.close}
      </button>
    </div>
  );
}

function SetupRequiredCallout({ eligibility }: { eligibility: Eligibility & { state: 'adoptable-with-setup' } }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 px-3 py-2.5 rounded-card border border-status-warning/35 bg-status-warning/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="typo-label uppercase tracking-wider text-status-warning">
            {t.recipes_catalog.callout_setup_title}
          </div>
          <div className="typo-caption text-foreground/85 mt-0.5">
            {t.recipes_catalog.callout_setup_body}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {eligibility.missingConnectors.map((slug) => {
              const m = getConnectorMeta(slug);
              return (
                <span
                  key={slug}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-secondary/40"
                  style={{ borderColor: m.color + '55' }}
                >
                  <ConnectorIcon meta={m} size="w-3.5 h-3.5" />
                  <span className="typo-caption font-medium" style={{ color: m.color }}>
                    {m.label}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="typo-caption text-foreground mt-2 inline-flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />
            {t.recipes_catalog.callout_setup_vault_link}
          </div>
        </div>
      </div>
    </div>
  );
}

function IncompatibleCallout({ eligibility }: { eligibility: Eligibility & { state: 'incompatible' } }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 px-3 py-2.5 rounded-card border border-card-border bg-secondary/40">
      <div className="typo-label uppercase tracking-wider text-foreground mb-1">
        {t.recipes_catalog.callout_incompatible_title}
      </div>
      <div className="typo-caption text-foreground/85">{eligibility.reason}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Binding inputs
// ---------------------------------------------------------------------------

interface BindingFieldProps {
  binding: RecipeBinding;
  value: BindingValue | undefined;
  onChange: (v: BindingValue | undefined) => void;
  error: boolean;
}

function BindingField({ binding, value, onChange, error }: BindingFieldProps) {
  const labelEl = (
    <div className="flex items-baseline gap-1.5 mb-1">
      <span className="typo-caption font-medium text-foreground">{binding.label}</span>
      {binding.required && (
        <span className="typo-label uppercase tracking-wider text-status-warning/85">required</span>
      )}
    </div>
  );
  const helpEl = binding.description && (
    <div className="typo-caption text-foreground mt-1">{binding.description}</div>
  );
  const wrapperCls = `rounded-card border bg-secondary/30 px-3 py-2.5 transition-colors ${
    error ? 'border-status-warning/45 bg-status-warning/8' : 'border-card-border'
  }`;

  return (
    <div className={wrapperCls}>
      {labelEl}
      <BindingInput kind={binding.kind} value={value} onChange={onChange} />
      {helpEl}
    </div>
  );
}

interface BindingInputProps {
  kind: BindingKind;
  value: BindingValue | undefined;
  onChange: (v: BindingValue | undefined) => void;
}

function BindingInput({ kind, value, onChange }: BindingInputProps) {
  const { t } = useTranslation();
  const inputCls = 'w-full px-2.5 py-1.5 rounded-input border border-card-border bg-secondary/40 typo-caption text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-primary/45 transition-colors';

  switch (kind.type) {
    case 'slack-channel': {
      // DEFERRED: live channel picker via the user's wired Slack workspace.
      // For now, plain text input — paste-able channel name.
      const placeholder = kind.multi ? t.recipes_catalog.placeholder_slack_multi : t.recipes_catalog.placeholder_slack_single;
      if (kind.multi) {
        const arr = Array.isArray(value) ? value : [];
        return (
          <input
            type="text"
            className={inputCls}
            placeholder={placeholder}
            value={arr.join(', ')}
            onChange={(e) => {
              const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              onChange(parts.length > 0 ? parts : undefined);
            }}
          />
        );
      }
      return (
        <input
          type="text"
          className={inputCls}
          placeholder={placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    }
    case 'google-drive-folder': {
      // DEFERRED: live folder picker.
      return (
        <input
          type="text"
          className={inputCls}
          placeholder={t.recipes_catalog.placeholder_drive_folder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    }
    case 'google-calendar': {
      // DEFERRED: live calendar picker.
      return (
        <input
          type="text"
          className={inputCls}
          placeholder={t.recipes_catalog.placeholder_calendar}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    }
    case 'github-repo': {
      // DEFERRED: live repo picker — should fetch from the user's wired GitHub credential.
      const placeholder = kind.multi ? t.recipes_catalog.placeholder_github_multi : t.recipes_catalog.placeholder_github_single;
      if (kind.multi) {
        const arr = Array.isArray(value) ? value : [];
        return (
          <input
            type="text"
            className={inputCls}
            placeholder={placeholder}
            value={arr.join(', ')}
            onChange={(e) => {
              const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              onChange(parts.length > 0 ? parts : undefined);
            }}
          />
        );
      }
      return (
        <input
          type="text"
          className={inputCls}
          placeholder={placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    }
    case 'email-address': {
      const placeholder = kind.multi ? t.recipes_catalog.placeholder_email_multi : t.recipes_catalog.placeholder_email_single;
      if (kind.multi) {
        const arr = Array.isArray(value) ? value : [];
        return (
          <input
            type="text"
            className={inputCls}
            placeholder={placeholder}
            value={arr.join(', ')}
            onChange={(e) => {
              const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              onChange(parts.length > 0 ? parts : undefined);
            }}
          />
        );
      }
      return (
        <input
          type="email"
          className={inputCls}
          placeholder={placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    }
    case 'text': {
      if (kind.multiline) {
        return (
          <textarea
            className={`${inputCls} min-h-[64px] resize-y`}
            placeholder={kind.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        );
      }
      return (
        <input
          type="text"
          className={inputCls}
          placeholder={kind.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    }
    case 'number': {
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={`${inputCls} max-w-[140px]`}
            min={kind.min}
            max={kind.max}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => {
              const n = e.target.value === '' ? undefined : Number(e.target.value);
              onChange(n);
            }}
          />
          {kind.unit && <span className="typo-caption text-foreground">{kind.unit}</span>}
        </div>
      );
    }
    case 'cron': {
      const presets = kind.presets ?? [];
      return (
        <div className="space-y-1.5">
          {presets.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {presets.map((p) => {
                const isActive = value === p.cron;
                return (
                  <button
                    key={p.cron}
                    type="button"
                    onClick={() => onChange(p.cron)}
                    className={`px-2 py-1 rounded-full border typo-label uppercase tracking-wider transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-primary/15 border-primary/35 text-primary'
                        : 'bg-secondary/40 border-card-border text-foreground hover:text-foreground hover:border-foreground/30'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
          <input
            type="text"
            className={`${inputCls} font-mono`}
            placeholder={t.recipes_catalog.placeholder_cron}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </div>
      );
    }
    case 'enum': {
      if (kind.multi) {
        const selected = new Set(Array.isArray(value) ? value : []);
        return (
          <div className="flex items-center gap-1 flex-wrap">
            {kind.options.map((opt) => {
              const isActive = selected.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    const next = new Set(selected);
                    if (isActive) next.delete(opt.value);
                    else next.add(opt.value);
                    onChange(next.size > 0 ? Array.from(next) : undefined);
                  }}
                  className={`px-2 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-primary/15 border-primary/35 text-primary'
                      : 'bg-secondary/40 border-card-border text-foreground hover:text-foreground hover:border-foreground/30'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <div className="flex items-center gap-1 flex-wrap">
          {kind.options.map((opt) => {
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={`px-2 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-primary/15 border-primary/35 text-primary'
                    : 'bg-secondary/40 border-card-border text-foreground hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }
  }
}

