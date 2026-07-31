import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { getModelRoutingRules, setModelRoutingRules } from '@/api/system/system';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { toastCatch } from '@/lib/silentCatch';
import type { ModelRoutingRule } from '@/lib/bindings/ModelRoutingRule';

import { PolicyProposalsSection } from './PolicyProposalsSection';

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh'] as const;
const INPUT_CLS =
  'rounded-input border border-primary/10 bg-secondary/40 px-2 py-1 typo-body text-foreground';

/**
 * F10: model-routing rules editor. Each rule tiers a model by persona category
 * (empty category = the default for all). Rules apply only when a persona has no
 * explicit model_profile. Persona-id-specific overrides stay command-only — the
 * common case is category tiering.
 */
export function ModelRoutingSection() {
  const { t } = useTranslation();
  const s = t.settings.engine;
  const [rules, setRules] = useState<ModelRoutingRule[]>([]);

  const fetchRules = useCallback(() => {
    getModelRoutingRules().then(setRules).catch(toastCatch('ModelRoutingSection:fetch'));
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Hand-editing a learned rule's selector/model invalidates its provenance
  // claim, so the stamp is dropped — a rule only carries provenance while it
  // is exactly what the applied proposal wrote.
  const patchCategory = (i: number, category: string) =>
    setRules((rs) =>
      rs.map((r, j) =>
        j === i
          ? { ...r, match: { ...r.match, category: category || undefined }, provenance: undefined }
          : r,
      ),
    );
  const patchModel = (i: number, model: string) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, model, provenance: undefined } : r)));
  const patchEffort = (i: number, effort: string) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, effort: effort || undefined } : r)));
  const addRule = () => setRules((rs) => [...rs, { match: {}, model: '' }]);
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    try {
      await setModelRoutingRules(rules);
      const fresh = await getModelRoutingRules();
      setRules(fresh);
    } catch (e) {
      // Server-side validation (blank model / unknown effort) surfaces here.
      toastCatch('ModelRoutingSection:save')(e);
    }
  };

  return (
    <div className="space-y-4">
      <p className="typo-caption text-foreground">{s.routing_subtitle}</p>

      {rules.length === 0 && <p className="typo-body text-foreground">{s.routing_empty}</p>}

      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className={`${INPUT_CLS} w-40`}
              value={rule.match.category ?? ''}
              placeholder={s.routing_category_ph}
              onChange={(e) => patchCategory(i, e.target.value)}
            />
            <input
              className={`${INPUT_CLS} flex-1 min-w-48`}
              value={rule.model}
              placeholder={s.routing_model_ph}
              onChange={(e) => patchModel(i, e.target.value)}
            />
            <select
              className={INPUT_CLS}
              value={rule.effort ?? ''}
              onChange={(e) => patchEffort(i, e.target.value)}
            >
              {EFFORTS.map((eff) => (
                <option key={eff || 'inherit'} value={eff}>
                  {eff === '' ? s.routing_effort_inherit : eff}
                </option>
              ))}
            </select>
            {rule.provenance && (
              <AthenaComposedBadge
                variant="composed"
                label={s.tuning_learned_badge}
                title={`${rule.provenance.claim} — ${rule.provenance.evidenceSnapshotId} @ ${rule.provenance.appliedAt}`}
              />
            )}
            <Button variant="ghost" onClick={() => removeRule(i)} aria-label={s.routing_remove}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={addRule}>
          <Plus className="w-4 h-4" />
          {s.routing_add}
        </Button>
        <AsyncButton variant="primary" onClick={save}>
          <Save className="w-4 h-4" />
          {s.routing_save}
        </AsyncButton>
      </div>

      <div className="border-t border-primary/10 pt-4">
        <PolicyProposalsSection onRulesChanged={fetchRules} />
      </div>
    </div>
  );
}
