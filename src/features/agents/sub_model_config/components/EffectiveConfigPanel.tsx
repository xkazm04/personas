import { Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import type { ConfigField } from '@/lib/bindings/ConfigField';
import { ConfigInheritanceBadge } from './ConfigInheritanceBadge';
import { useTranslation } from '@/i18n/useTranslation';

interface EffectiveConfigPanelProps {
  config: EffectiveModelConfig | null;
  loading?: boolean;
}

function FieldRow({ label, field, workspaceName, mask }: {
  label: string;
  field: ConfigField<string | number>;
  workspaceName?: string | null;
  mask?: boolean;
}) {
  const displayValue = field.value == null
    ? '--'
    : mask
    ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'
    : String(field.value);

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground/70 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`text-xs font-mono truncate max-w-[140px] ${
            field.source === 'default' ? 'text-muted-foreground/40 italic' : 'text-foreground/80'
          }`}
          title={field.value != null && !mask ? String(field.value) : undefined}
        >
          {displayValue}
        </span>
        <ConfigInheritanceBadge
          source={field.source}
          isOverridden={field.isOverridden}
          workspaceName={workspaceName}
        />
      </div>
    </div>
  );
}

export function EffectiveConfigPanel({ config, loading }: EffectiveConfigPanelProps) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="bg-secondary/20 border border-primary/10 rounded-lg p-2.5 animate-pulse">
        <div className="h-4 bg-secondary/40 rounded w-32" />
      </div>
    );
  }

  if (!config) return null;

  // Count how many fields are inherited (not agent-level and not default)
  const fields = [config.model, config.provider, config.baseUrl, config.maxBudgetUsd, config.maxTurns, config.promptCachePolicy];
  const inheritedCount = fields.filter(f => f.source === 'workspace' || f.source === 'global').length;
  const overriddenCount = fields.filter(f => f.isOverridden).length;

  const hasInheritance = inheritedCount > 0 || overriddenCount > 0;

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-secondary/30 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/70">
          <Layers className="w-3 h-3 text-primary/60" />
          {mc.effective_config}
          {hasInheritance && (
            <span className="text-[10px] text-muted-foreground/50">
              {inheritedCount > 0 && `${inheritedCount} ${mc.inherited}`}
              {inheritedCount > 0 && overriddenCount > 0 && ' \u00B7 '}
              {overriddenCount > 0 && `${overriddenCount} ${mc.overridden}`}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 space-y-0.5 border-t border-primary/5">
          {config.workspaceName && (
            <div className="pt-1.5 pb-0.5">
              <span className="text-[10px] text-blue-400/60 uppercase tracking-wider font-medium">
                Workspace: {config.workspaceName}
              </span>
            </div>
          )}
          <FieldRow label={mc.field_model} field={config.model} workspaceName={config.workspaceName} />
          <FieldRow label={mc.field_provider} field={config.provider} workspaceName={config.workspaceName} />
          <FieldRow label={mc.field_base_url} field={config.baseUrl} workspaceName={config.workspaceName} />
          <FieldRow label={mc.field_auth_token} field={config.authToken} workspaceName={config.workspaceName} mask />
          <FieldRow label={mc.field_max_budget} field={config.maxBudgetUsd} workspaceName={config.workspaceName} />
          <FieldRow label={mc.field_max_turns} field={config.maxTurns} workspaceName={config.workspaceName} />
          <FieldRow label={mc.field_prompt_cache} field={config.promptCachePolicy} workspaceName={config.workspaceName} />
        </div>
      )}
    </div>
  );
}
