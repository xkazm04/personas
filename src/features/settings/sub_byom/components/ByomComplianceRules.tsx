import { Plus, Trash2, ToggleLeft, ToggleRight, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import type { ComplianceRule } from '@/api/system/byom';
import { PROVIDER_OPTIONS, type PolicyWarning, type PolicyWarningSeverity } from '../libs/byomHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

const SEVERITY_STYLES: Record<PolicyWarningSeverity, { border: string; text: string; icon: typeof AlertTriangle }> = {
  error:   { border: 'border-status-error/30',   text: 'text-status-error/90',   icon: AlertCircle },
  warning: { border: 'border-status-warning/30', text: 'text-status-warning/90', icon: AlertTriangle },
  info:    { border: 'border-status-info/30',  text: 'text-status-info/90',  icon: Info },
};

interface ByomComplianceRulesProps {
  rules: ComplianceRule[];
  warnings: Map<number, PolicyWarning[]>;
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<ComplianceRule>) => void;
  onRemove: (index: number) => void;
}

export function ByomComplianceRules({ rules, warnings, onAdd, onUpdate, onRemove }: ByomComplianceRulesProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.byom;
  return (
    <div className="space-y-4">
      <div className="rounded-modal border border-hair bg-card-bg p-4 space-y-4">
        <SectionHeading
          title={s.compliance_title}
          action={
            <Button
              type="button"
              onClick={onAdd}
              variant="secondary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              {s.add_rule}
            </Button>
          }
        />
        <p className="typo-body text-foreground mt-1">
          {s.compliance_hint}
        </p>

        {rules.length === 0 ? (
          <p className="typo-body text-foreground text-center py-6">
            {s.compliance_empty}
          </p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, idx) => {
              const ruleWarnings = warnings.get(idx);
              const worstSeverity = ruleWarnings?.length
                ? (ruleWarnings.some((w) => w.severity === 'error') ? 'error'
                  : ruleWarnings.some((w) => w.severity === 'warning') ? 'warning' : 'info') as PolicyWarningSeverity
                : null;
              const WorstIcon = worstSeverity ? SEVERITY_STYLES[worstSeverity].icon : null;
              // Build set of provider ids with warnings for this rule, keyed by worst severity
              const warnedProviders = new Map<string, PolicyWarningSeverity>();
              if (ruleWarnings) {
                for (const w of ruleWarnings) {
                  for (const prov of PROVIDER_OPTIONS) {
                    if (w.provider === prov.id) {
                      const existing = warnedProviders.get(prov.id);
                      if (!existing || w.severity === 'error' || (w.severity === 'warning' && existing === 'info')) {
                        warnedProviders.set(prov.id, w.severity);
                      }
                    }
                  }
                }
              }
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-card border bg-surface-1 space-y-3 ${
                    worstSeverity ? SEVERITY_STYLES[worstSeverity].border : 'border-hair'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {WorstIcon ? (
                        <WorstIcon className={`w-4 h-4 ${SEVERITY_STYLES[worstSeverity!].text} shrink-0`} />
                      ) : null}
                      <input
                        value={rule.name}
                        onChange={(e) => onUpdate(idx, { name: e.target.value })}
                        className="typo-body bg-transparent border-none outline-none text-foreground"
                        placeholder={s.compliance_name_placeholder}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        onClick={() => onUpdate(idx, { enabled: !rule.enabled })}
                        aria-pressed={rule.enabled}
                        aria-label={tx(rule.enabled ? t.common.disable_item : t.common.enable_item, { name: rule.name || s.compliance_name_placeholder })}
                        variant="ghost"
                        size="sm"
                      >
                        {rule.enabled
                          ? <ToggleRight className="w-5 h-5 text-status-success" />
                          : <ToggleLeft className="w-5 h-5 text-foreground" />
                        }
                      </Button>
                      <Button
                        type="button"
                        onClick={() => onRemove(idx)}
                        aria-label={`${t.common.delete}: ${rule.name || s.compliance_name_placeholder}`}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-3">
                    <div>
                      <label className="typo-caption text-foreground mb-1 block">
                        {s.workflow_tags}
                      </label>
                      <input
                        value={rule.workflow_tags.join(', ')}
                        onChange={(e) =>
                          onUpdate(idx, {
                            workflow_tags: e.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder={s.workflow_tags_placeholder}
                        className="w-full typo-body p-2 rounded-card border border-hair bg-surface-2 text-foreground outline-none placeholder:text-ink-3"
                      />
                    </div>
                    <div>
                      <label className="typo-caption text-foreground mb-1 block">
                        {s.allowed_providers_label}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {PROVIDER_OPTIONS.map((prov) => {
                          const isSelected = rule.allowed_providers.includes(prov.id);
                          const provSeverity = warnedProviders.get(prov.id);
                          return (
                            <Button
                              key={prov.id}
                              type="button"
                              onClick={() => {
                                const updated = isSelected
                                  ? rule.allowed_providers.filter((id) => id !== prov.id)
                                  : [...rule.allowed_providers, prov.id];
                                onUpdate(idx, { allowed_providers: updated });
                              }}
                              variant={isSelected ? 'accent' : 'secondary'}
                              tone={isSelected ? (provSeverity === 'error' ? 'error' : provSeverity === 'warning' ? 'warning' : 'info') : undefined}
                              size="xs"
                            >
                              {prov.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {ruleWarnings?.length ? (
                    <div className="space-y-1">
                      {ruleWarnings.map((w, wi) => {
                        const style = SEVERITY_STYLES[w.severity];
                        const WarnIcon = style.icon;
                        return (
                          <Tooltip key={wi} content={w.severity === 'info' ? w.message : undefined}><div className={`flex items-start gap-1.5 typo-caption ${style.text}`}
                          >
                            <WarnIcon className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>{w.message}</span>
                          </div></Tooltip>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
