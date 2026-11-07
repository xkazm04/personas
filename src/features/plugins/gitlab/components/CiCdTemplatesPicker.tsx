import { useState } from 'react';
import { Cpu, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import {
  CICD_TEMPLATES,
  GITLAB_TIERS,
  getTierDef,
  tierSatisfies,
  type CiCdTemplate,
  type GitLabTierId,
} from '../data/cicdTemplates';
import { useTranslation } from '@/i18n/useTranslation';
import { PressSurface } from '@/features/shared/components/buttons';

interface CiCdTemplatesPickerProps {
  userTier: GitLabTierId;
  onSelectTemplate: (template: CiCdTemplate) => void;
}

export function CiCdTemplatesPicker({ userTier, onSelectTemplate }: CiCdTemplatesPickerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      <PressSurface onPress={() => setExpanded(!expanded)} className="flex items-center gap-2 w-full">
        <Cpu className="w-4 h-4 text-status-warning" />
        <span className="typo-body text-ink-1">{t.gitlab.cicd_agent_templates}</span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-ink-1 ml-auto" />
          : <ChevronDown className="w-3.5 h-3.5 text-ink-1 ml-auto" />
        }
      </PressSurface>

      {expanded && (
        <div className="space-y-2">
          {/* Tier selector legend */}
          <div className="flex items-center gap-2 flex-wrap">
            {GITLAB_TIERS.map((tier) => (
              <span
                key={tier.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 typo-caption rounded-interactive border ${tier.borderColor} ${tier.bgColor} ${tier.color}`}
              >
                {tier.name}
                {tier.id === userTier && (
                  <span className="typo-caption opacity-60">{t.gitlab.your_tier}</span>
                )}
              </span>
            ))}
          </div>

          {/* Template cards */}
          <div className="grid gap-2">
            {CICD_TEMPLATES.map((template) => {
              const available = tierSatisfies(userTier, template.minTier);
              const tierDef = getTierDef(template.minTier);

              return (
                <PressSurface key={template.id} disabled={!available} onPress={() => onSelectTemplate(template)} className="p-3 rounded-modal border border-hair">
                  <div className="flex items-start gap-2.5">
                    <span className="typo-heading-lg mt-0.5">{template.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="typo-body text-ink-2">
                          {template.name}
                        </span>
                        {template.minTier !== 'free' && (
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 typo-caption rounded-interactive border ${tierDef.borderColor} ${tierDef.bgColor} ${tierDef.color}`}>
                            {!available && <Lock className="w-2.5 h-2.5" />}
                            {tierDef.name}
                          </span>
                        )}
                      </div>
                      <p className="typo-caption text-ink-2 mt-0.5 line-clamp-2">
                        {template.description}
                      </p>
                      <span className="inline-block mt-1 typo-caption text-ink-2 font-mono">
                        {t.gitlab.trigger_on} {template.trigger}
                      </span>
                    </div>
                  </div>
                </PressSurface>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
