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

interface CiCdTemplatesPickerProps {
  userTier: GitLabTierId;
  onSelectTemplate: (template: CiCdTemplate) => void;
}

export function CiCdTemplatesPicker({ userTier, onSelectTemplate }: CiCdTemplatesPickerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Cpu className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-medium text-foreground/80">CI/CD Agent Templates</span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
        }
      </button>

      {expanded && (
        <div className="space-y-2">
          {/* Tier selector legend */}
          <div className="flex items-center gap-2 flex-wrap">
            {GITLAB_TIERS.map((tier) => (
              <span
                key={tier.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${tier.borderColor} ${tier.bgColor} ${tier.color}`}
              >
                {tier.name}
                {tier.id === userTier && (
                  <span className="text-[10px] opacity-60">(yours)</span>
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
                <button
                  key={template.id}
                  type="button"
                  disabled={!available}
                  onClick={() => onSelectTemplate(template)}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    available
                      ? 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20 cursor-pointer'
                      : 'border-primary/5 bg-secondary/10 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg leading-none mt-0.5">{template.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground/90">
                          {template.name}
                        </span>
                        {template.minTier !== 'free' && (
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full border ${tierDef.borderColor} ${tierDef.bgColor} ${tierDef.color}`}>
                            {!available && <Lock className="w-2.5 h-2.5" />}
                            {tierDef.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/60 mt-0.5 line-clamp-2">
                        {template.description}
                      </p>
                      <span className="inline-block mt-1 text-[10px] text-muted-foreground/60 font-mono">
                        on: {template.trigger}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
