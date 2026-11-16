import type { FlowNode } from '@/lib/types/frontendTypes';
import { NODE_TYPE_META, DEFAULT_NODE_META } from './activityDiagramTypes';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

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

  const baseClasses = 'px-4 py-2.5 rounded-modal border min-w-[140px] max-w-[220px] text-center';

  const truncatedLabel = node.label.length > 30 ? node.label.slice(0, 28) + '\u2026' : node.label;

  return (
    <PressSurface
      className={`${baseClasses} ${meta.cardStyle}`}
      onPress={(e) => onClick(node, e)}
    >
      <div className="flex items-center justify-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${meta.iconColor}`} />
        <span className={`typo-body ${meta.textColor}`}>{truncatedLabel}</span>
      </div>
    </PressSurface>
  );
}
