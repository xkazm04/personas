import { Globe, FolderOpen, User, Minus } from 'lucide-react';
import type { ConfigSource } from '@/lib/bindings/ConfigSource';
import { useTranslation } from '@/i18n/useTranslation';

const SOURCE_ICONS: Record<ConfigSource, typeof Globe> = {
  agent: User,
  workspace: FolderOpen,
  global: Globe,
  default: Minus,
};

const SOURCE_STYLES: Record<ConfigSource, { color: string; bg: string }> = {
  agent:     { color: 'text-violet-400',  bg: 'bg-violet-500/10' },
  workspace: { color: 'text-blue-400',    bg: 'bg-blue-500/10' },
  global:    { color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  default:   { color: 'text-foreground', bg: 'bg-secondary/30' },
};

interface ConfigInheritanceBadgeProps {
  source: ConfigSource;
  isOverridden?: boolean;
  /** Optional workspace name to display in tooltip */
  workspaceName?: string | null;
}

export function ConfigInheritanceBadge({ source, isOverridden, workspaceName }: ConfigInheritanceBadgeProps) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  const Icon = SOURCE_ICONS[source];
  const style = SOURCE_STYLES[source];

  const sourceLabels: Record<ConfigSource, string> = {
    agent: mc.source_agent,
    workspace: mc.source_workspace,
    global: mc.source_global,
    default: mc.source_default,
  };

  const tooltip = source === 'workspace' && workspaceName
    ? mc.tooltip_workspace.replace('{name}', workspaceName)
    : source === 'global'
    ? mc.tooltip_global
    : source === 'agent'
    ? isOverridden ? mc.tooltip_agent_override : mc.tooltip_agent_set
    : mc.tooltip_default;

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${style.color} ${style.bg} transition-colors`}
    >
      <Icon className="w-2.5 h-2.5" />
      {sourceLabels[source]}
      {isOverridden && source === 'agent' && (
        <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" title={mc.tooltip_overriding} />
      )}
    </span>
  );
}
