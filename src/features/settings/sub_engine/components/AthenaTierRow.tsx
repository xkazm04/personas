import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { FormField } from '@/features/shared/components/forms/FormField';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getAnthropicModels } from '@/lib/models/modelCatalog';
import type { AthenaEngine } from '@/lib/bindings/AthenaEngine';
import type { AthenaTierSettings } from '@/lib/bindings/AthenaTierSettings';
import type { TurnTierClass } from '@/lib/bindings/TurnTierClass';

/** Brand names, not copy: never translated. */
export const ENGINE_LABELS: Record<AthenaEngine, string> = { claude: 'Claude', grok: 'Grok' };
const ENGINES: AthenaEngine[] = ['claude', 'grok'];
/** `''` = the calibrated default for the tier (see `AthenaTierSettings`). */
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh'] as const;

interface Option {
  id: string;
  label: string;
}

interface TierSelectProps {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  testId: string;
  disabled?: boolean;
  inputId?: string;
}

function TierSelect({ options, value, onChange, ariaLabel, testId, disabled, inputId }: TierSelectProps) {
  // A stored id the list does not carry (a default the alias catalog does not
  // spell, or a model the probe no longer reports) is shown verbatim, so the
  // operator sees what is persisted rather than an empty trigger.
  const match = options.find((o) => o.id === value);
  const current = match ? match.label : value;
  return (
    <Listbox
      ariaLabel={ariaLabel}
      className="min-w-[10rem]"
      itemCount={options.length}
      onSelectFocused={(i) => options[i] && onChange(options[i].id)}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          id={inputId}
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-expanded={isOpen}
          data-testid={testId}
          className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-input typo-caption border border-primary/15 bg-secondary/40 text-foreground hover:border-primary/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="flex-1 text-left truncate">{current}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    >
      {({ close }) => (
        <div className="py-1">
          {options.map((o) => (
            <button
              key={o.id || 'default'}
              type="button"
              role="option"
              aria-selected={o.id === value}
              data-testid={`${testId}-option-${o.id || 'default'}`}
              onClick={() => {
                onChange(o.id);
                close();
              }}
              className={`flex items-center gap-2 w-full px-3 py-1.5 typo-caption transition-colors hover:bg-secondary/40 ${o.id === value ? 'text-primary' : 'text-foreground'}`}
            >
              <span className="flex-1 text-left truncate">{o.label}</span>
              {o.id === value && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </Listbox>
  );
}

interface AthenaTierRowProps {
  cls: TurnTierClass;
  tier: AthenaTierSettings;
  /** Engines the probe reported as installed; `null` while still probing. */
  installed: Set<AthenaEngine> | null;
  /** Model ids the grok probe reported (`grok models`); empty until it answers. */
  grokModels: string[];
  onChange: (patch: Partial<AthenaTierSettings>) => void;
}

/** One tier (Main / Aside / Micro): engine, model filtered by engine, effort. */
export function AthenaTierRow({ cls, tier, installed, grokModels, onChange }: AthenaTierRowProps) {
  const { t } = useTranslation();
  const s = t.settings.athenaTiers;
  const engineMissing = installed !== null && !installed.has(tier.engine);

  const catalog: Option[] =
    tier.engine === 'grok'
      ? grokModels.map((id) => ({ id, label: id }))
      : getAnthropicModels(t).map((m) => ({ id: m.id, label: m.label }));
  const modelOptions: Option[] = [{ id: '', label: s.model_default }, ...catalog];
  // The calibrated defaults persist full ids (`claude-opus-5`) the alias
  // catalog does not list; keep the stored value selectable rather than
  // silently showing the wrong choice.
  if (tier.model && !modelOptions.some((o) => o.id === tier.model)) {
    modelOptions.splice(1, 0, { id: tier.model, label: tier.model });
  }
  const effortOptions: Option[] = EFFORTS.map((e) => ({
    id: e,
    label: e === '' ? s.effort_default : t.models[`effort_${e}`],
  }));

  return (
    <div
      data-testid={`athena-tier-row-${cls}`}
      className="rounded-card border border-primary/10 bg-secondary/20 p-3 space-y-2"
    >
      <div>
        <p className="typo-body text-foreground font-medium">{s[`${cls}_label`]}</p>
        <p className="typo-caption text-foreground">{s[`${cls}_description`]}</p>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <FormField label={s.engine_label}>
          {({ id }) => (
            <TierSelect
              inputId={id}
              ariaLabel={s.engine_label}
              testId={`athena-tier-engine-${cls}`}
              options={ENGINES.map((e) => ({ id: e, label: ENGINE_LABELS[e] }))}
              value={tier.engine}
              // A grok model id is not a claude one: switching engines returns
              // the model to the tier default.
              onChange={(id) => onChange({ engine: id as AthenaEngine, model: '' })}
            />
          )}
        </FormField>
        <FormField label={s.model_label} helpText={engineMissing ? s.not_installed : undefined}>
          {({ id }) => (
            <TierSelect
              inputId={id}
              ariaLabel={s.model_label}
              testId={`athena-tier-model-${cls}`}
              options={modelOptions}
              value={tier.model}
              disabled={engineMissing}
              onChange={(model) => onChange({ model })}
            />
          )}
        </FormField>
        <FormField label={s.effort_label}>
          {({ id }) => (
            <TierSelect
              inputId={id}
              ariaLabel={s.effort_label}
              testId={`athena-tier-effort-${cls}`}
              options={effortOptions}
              value={tier.effort}
              onChange={(effort) => onChange({ effort })}
            />
          )}
        </FormField>
      </div>
      {tier.engine === 'grok' && (
        <Tooltip content={s.fallback_note}>
          <p className="typo-caption text-foreground">{s.grok_note}</p>
        </Tooltip>
      )}
    </div>
  );
}
