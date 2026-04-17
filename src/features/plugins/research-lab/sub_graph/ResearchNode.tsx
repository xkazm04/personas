import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeData } from './graphLayout';

type Props = NodeProps & { data: GraphNodeData };

function ResearchNodeImpl({ data, selected }: Props) {
  const isProject = data.kind === 'project';
  return (
    <div
      className={`rounded-card border px-3 py-2 min-w-[180px] max-w-[220px] shadow-elevation-1 transition-all ${
        selected ? 'ring-2 ring-primary/60' : ''
      } ${isProject ? 'bg-background' : 'bg-secondary/60'}`}
      style={{ borderColor: `${data.color}66` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary/40" />
      <div className="flex items-start gap-2">
        <span
          className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: data.color }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="typo-caption text-foreground font-medium truncate">{data.label}</p>
          {data.sublabel && (
            <p className="typo-caption text-foreground truncate mt-0.5">{data.sublabel}</p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary/40" />
    </div>
  );
}

export const ResearchNode = memo(ResearchNodeImpl);
