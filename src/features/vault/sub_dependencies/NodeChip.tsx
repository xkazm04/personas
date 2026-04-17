import type { GraphNode } from './credentialGraph';
import { KIND_ICONS } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface NodeChipProps {
  node: GraphNode;
  isSelected: boolean;
  onClick: () => void;
  extra?: React.ReactNode;
}

export function NodeChip({ node, isSelected, onClick, extra }: NodeChipProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  const Icon = KIND_ICONS[node.kind];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-card text-left transition-colors cursor-pointer ${
        isSelected
          ? 'bg-primary/10 border border-primary/25'
          : 'hover:bg-secondary/40 border border-transparent'
      }`}
    >
      <div
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: `${node.color}20`, border: `1px solid ${node.color}40` }}
      >
        <Icon className="w-3 h-3" style={{ color: node.color }} />
      </div>
      <span className="text-xs text-foreground truncate flex-1">{node.label}</span>
      {node.meta.serviceType && (
        <span className="text-xs text-foreground font-mono truncate max-w-[80px]">{node.meta.serviceType}</span>
      )}
      {node.meta.dependentCount != null && node.meta.dependentCount > 0 && (
        <span className="text-xs text-blue-400/60">{tx(node.meta.dependentCount !== 1 ? dep.dep_count_other : dep.dep_count_one, { count: node.meta.dependentCount })}</span>
      )}
      {extra}
    </button>
  );
}

export function HealthDot({ success }: { success: boolean | null }) {
  const { t } = useTranslation();
  const dep = t.vault.dependencies;
  if (success === null) return <div className="w-2 h-2 rounded-full bg-gray-500/40 flex-shrink-0" title={dep.not_tested} />;
  return (
    <div
      className={`w-2 h-2 rounded-full flex-shrink-0 ${success ? 'bg-emerald-400' : 'bg-red-400'}`}
      title={success ? dep.healthy : dep.unhealthy}
    />
  );
}
