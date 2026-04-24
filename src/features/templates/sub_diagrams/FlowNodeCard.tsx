import type { FlowNode } from '@/lib/types/frontendTypes';
import { NODE_TYPE_META, DEFAULT_NODE_META } from './activityDiagramTypes';

// ============================================================================
// Flow Node Card
// ============================================================================

export default function FlowNodeCard({
  node,
  onClick,
}: {
  node: FlowNode;
  onClick: (node: FlowNode, e: React.MouseEvent) => void;
}) {
  const meta = NODE_TYPE_META[node.type] ?? DEFAULT_NODE_META;
  const Icon = meta.Icon;

  const baseClasses = 'cursor-pointer px-4 py-2.5 rounded-modal border min-w-[140px] max-w-[220px] text-center transition-all hover:scale-105 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-background';

  const truncatedLabel = node.label.length > 30 ? node.label.slice(0, 28) + '\u2026' : node.label;

  return (
    <button
      type="button"
      className={`${baseClasses} ${meta.cardStyle}`}
      onClick={(e) => onClick(node, e)}
    >
      <div className="flex items-center justify-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${meta.iconColor}`} />
        <span className={`typo-body font-medium ${meta.textColor}`}>{truncatedLabel}</span>
      </div>
    </button>
  );
}
