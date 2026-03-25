import { Globe, FolderOpen, User, Minus } from 'lucide-react';
import type { ConfigSource } from '@/lib/bindings/ConfigSource';

const SOURCE_META: Record<ConfigSource, { label: string; icon: typeof Globe; color: string; bg: string }> = {
  agent:     { label: 'Agent',     icon: User,       color: 'text-violet-400',  bg: 'bg-violet-400/10' },
  workspace: { label: 'Workspace', icon: FolderOpen, color: 'text-blue-400',    bg: 'bg-blue-400/10' },
  global:    { label: 'Global',    icon: Globe,      color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  default:   { label: 'Default',   icon: Minus,      color: 'text-muted-foreground/50', bg: 'bg-secondary/30' },
};

interface ConfigInheritanceBadgeProps {
  source: ConfigSource;
  isOverridden?: boolean;
  /** Optional workspace name to display in tooltip */
  workspaceName?: string | null;
}

export function ConfigInheritanceBadge({ source, isOverridden, workspaceName }: ConfigInheritanceBadgeProps) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;

  const tooltip = source === 'workspace' && workspaceName
    ? `Inherited from workspace "${workspaceName}"`
    : source === 'global'
    ? 'Inherited from global defaults'
    : source === 'agent'
    ? isOverridden ? 'Overrides workspace/global default' : 'Set on this agent'
    : 'No value configured';

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${meta.color} ${meta.bg} transition-colors`}
    >
      <Icon className="w-2.5 h-2.5" />
      {meta.label}
      {isOverridden && source === 'agent' && (
        <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" title="Overriding inherited value" />
      )}
    </span>
  );
}
