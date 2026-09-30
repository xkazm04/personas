/**
 * Settings -> API Keys -> Gig persona policy.
 *
 * kp hires one persona per gig. Approving each hire by hand stops scaling at a
 * few dozen open gigs, so the operator sets a bound here once: a kp hire
 * request that lies inside every condition (policy on, the gig-persona kind,
 * budget at or under the cap when one is set, an allowed model, a project
 * inside the gig root) is approved on the operator's behalf; anything else
 * waits in the approval inbox as before. An empty budget field is NO CAP
 * (`maxBudgetUsd: null`): the request's budget is then neither required nor
 * compared. The setting is operator-only: no API key can change it.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { FormField } from '@/features/shared/components/forms/FormField';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import Button from '@/features/shared/components/buttons/Button';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import {
  getGigPersonaPolicy,
  setGigPersonaPolicy,
  type GigPersonaPolicy,
} from '@/api/auth/gigPersonaPolicy';

interface Draft {
  enabled: boolean;
  maxBudgetUsd: string;
  /** The number input holds text it cannot parse (its `value` then reads ''). */
  budgetBadInput: boolean;
  allowedModels: string;
  rootPath: string;
}

function toDraft(p: GigPersonaPolicy): Draft {
  return {
    enabled: p.enabled,
    // A stored `null` is no cap, shown as an empty field.
    maxBudgetUsd: p.maxBudgetUsd === null ? '' : String(p.maxBudgetUsd),
    budgetBadInput: false,
    allowedModels: p.allowedModels.join(', '),
    rootPath: p.rootPath,
  };
}

/** An empty budget field is no cap (`null`); anything else is the typed number. */
function budgetFromDraft(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * A budget the field cannot read. Saving it is blocked rather than sent: a
 * number input reports unparseable text (`5,5` in a `.`-decimal locale) as an
 * EMPTY value, and NaN serializes to `null` — either way a typo would silently
 * read as "no cap".
 */
function budgetUnreadable(d: Draft): boolean {
  if (d.budgetBadInput) return true;
  const budget = budgetFromDraft(d.maxBudgetUsd);
  return budget !== null && !Number.isFinite(budget);
}

function fromDraft(d: Draft): GigPersonaPolicy {
  return {
    enabled: d.enabled,
    maxBudgetUsd: budgetFromDraft(d.maxBudgetUsd),
    allowedModels: d.allowedModels
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0),
    rootPath: d.rootPath.trim(),
  };
}

export function GigPersonaPolicySection() {
  const { t } = useTranslation();
  const s = t.settings.api_keys;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const p = await getGigPersonaPolicy();
        if (live) setDraft(toDraft(p));
      } catch (e) {
        // Shown in the section's error row, like the key list's load error.
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const stored = await setGigPersonaPolicy(fromDraft(draft));
      setDraft(toDraft(stored));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [draft]);

  return (
    <div className="mt-6" data-testid="gig-persona-policy">
      <SectionCard
        title={s.gig_policy_title}
        icon={<ShieldCheck className="w-4 h-4 text-status-success" />}
        titleClassName="text-primary"
      >
        <p className="typo-caption text-foreground mb-3">{s.gig_policy_desc}</p>
        {error && (
          <div className="flex items-center gap-2 typo-caption text-status-error bg-status-error/10 rounded-card p-2 mb-3">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}
        {draft && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AccessibleToggle
                checked={draft.enabled}
                onChange={() => update({ enabled: !draft.enabled })}
                label={s.gig_policy_enabled}
                data-testid="gig-policy-enabled"
              />
              <span className="typo-body text-foreground">{s.gig_policy_enabled}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormField label={s.gig_policy_budget_label} helpText={s.gig_policy_budget_hint}>
                {(inputProps) => (
                  <input
                    {...inputProps}
                    type="number"
                    min={0}
                    step="0.5"
                    value={draft.maxBudgetUsd}
                    onChange={(e) =>
                      update({
                        maxBudgetUsd: e.target.value,
                        budgetBadInput: e.target.validity.badInput,
                      })
                    }
                    aria-invalid={budgetUnreadable(draft) || undefined}
                    className={INPUT_FIELD}
                    data-testid="gig-policy-budget"
                  />
                )}
              </FormField>
              <FormField label={s.gig_policy_models_label} helpText={s.gig_policy_models_hint}>
                {(inputProps) => (
                  <input
                    {...inputProps}
                    type="text"
                    value={draft.allowedModels}
                    onChange={(e) => update({ allowedModels: e.target.value })}
                    className={INPUT_FIELD}
                    data-testid="gig-policy-models"
                  />
                )}
              </FormField>
            </div>
            <FormField label={s.gig_policy_root_label} helpText={s.gig_policy_root_hint}>
              {(inputProps) => (
                <input
                  {...inputProps}
                  type="text"
                  value={draft.rootPath}
                  onChange={(e) => update({ rootPath: e.target.value })}
                  className={INPUT_FIELD}
                  data-testid="gig-policy-root"
                />
              )}
            </FormField>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                loadingLabel={t.common.saving}
                disabled={budgetUnreadable(draft)}
                onClick={() => void save()}
                data-testid="gig-policy-save"
              >
                {s.gig_policy_save}
              </Button>
              {saved && (
                <span className="typo-caption text-status-success inline-flex items-center gap-1">
                  <Check size={12} />
                  {s.gig_policy_saved}
                </span>
              )}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
