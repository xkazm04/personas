import { Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import type { ConfigField } from '@/lib/bindings/ConfigField';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConfigInheritanceBadge } from './ConfigInheritanceBadge';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


interface EffectiveConfigPanelProps {
  config: EffectiveModelConfig | null;
  loading?: boolean;
}

function FieldRow({ label, field, workspaceName, mask }: {
  label: string;
  field: ConfigField;
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
      <span className="typo-caption text-foreground flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {/* The full value is reachable only through this tip when the cell
            truncates. Tooltip renders the child untouched when `content` is
            empty, so masked and unset rows stay plain. */}
        <Tooltip content={field.value != null && !mask ? String(field.value) : ''}>
          <span
            tabIndex={field.value != null && !mask ? 0 : undefined}
            className={`typo-code font-mono truncate max-w-[140px] ${
              field.source === 'default' ? 'text-foreground italic' : 'text-foreground'
            }`}
          >
            {displayValue}
          </span>
        </Tooltip>
        <ConfigInheritanceBadge
          source={field.source}
          isOverridden={field.isOverridden}
          workspaceName={workspaceName}
        />
      </div>
    </div>
  );
}

/** Calm, geometry-matched ghost for the seven field rows. Delayed past 120ms so a
    fast resolve never paints it (overview-loading.md law 3). Never `animate-pulse`. */
function ConfigGhostRows() {
  return (
    <div aria-hidden className="px-2.5 pb-2 space-y-0.5 border-t border-primary/5">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-2 py-1">
          <div
            className={`h-3 rounded bg-primary/[0.06] animate-fade-in ${['w-20', 'w-16', 'w-24', 'w-14'][i % 4]}`}
            style={{ animationDelay: `${120 + i * 35}ms` }}
          />
          <div
            className={`h-3 rounded bg-primary/[0.06] animate-fade-in ${['w-24', 'w-32', 'w-20', 'w-28'][i % 4]}`}
            style={{ animationDelay: `${120 + i * 35}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

export function EffectiveConfigPanel({ config, loading }: EffectiveConfigPanelProps) {
  const { t, tx } = useTranslation();
  const mc = t.agents.model_config;
  const [expanded, setExpanded] = useState(false);

  // A refresh never hides config already on screen (law 1); the flag only decides
  // what an EMPTY panel shows. The header/toggle is permanent chrome (law 5) and
  // is never inside a loading branch.
  const pending = !config && !!loading;

  if (!config && !pending) return null;

  // Count how many fields are inherited (not agent-level and not default)
  const fields = config
    ? [config.model, config.provider, config.baseUrl, config.maxBudgetUsd, config.maxTurns, config.promptCachePolicy]
    : [];
  const inheritedCount = fields.filter(f => f.source === 'workspace' || f.source === 'global').length;
  const overriddenCount = fields.filter(f => f.isOverridden).length;

  const hasInheritance = inheritedCount > 0 || overriddenCount > 0;

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-secondary/30 transition-colors"
      >
        <span className="flex items-center gap-1.5 typo-caption font-medium text-foreground">
          <Layers className="w-3 h-3 text-primary/60" />
          {mc.effective_config}
          {pending && (
            <span
              aria-hidden
              className="h-3 w-16 rounded bg-primary/[0.06] animate-fade-in"
              style={{ animationDelay: '120ms' }}
            />
          )}
          {hasInheritance && (
            <span className="text-[10px] text-foreground">
              {inheritedCount > 0 && tx(mc.inherited, { count: inheritedCount })}
              {inheritedCount > 0 && overriddenCount > 0 && ' \u00B7 '}
              {overriddenCount > 0 && tx(mc.overridden, { count: overriddenCount })}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-foreground" />
        ) : (
          <ChevronDown className="w-3 h-3 text-foreground" />
        )}
      </button>

      {expanded && pending && <ConfigGhostRows />}

      {expanded && config && (
        <div className="px-2.5 pb-2 space-y-0.5 border-t border-primary/5">
          {config.workspaceName && (
            <div className="pt-1.5 pb-0.5">
              <span className="text-[10px] text-blue-400/60 uppercase tracking-wider font-medium">
                <DebtText k="auto_workspace_92b51a97" /> {config.workspaceName}
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
