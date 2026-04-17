import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import type { ConditionGateNodeData } from '../libs/triggerStudioConstants';

function ConditionGateNodeInner({ data, selected }: NodeProps) {
  const d = data as ConditionGateNodeData;
  const branches = d.branches ?? [];

  return (
    <div
      className={`
        relative flex flex-col gap-1.5 px-3.5 py-3 rounded-modal
        bg-card backdrop-blur border-2
        ${selected
          ? 'border-violet-400 ring-2 ring-violet-400/25 shadow-[0_0_16px_rgba(139,92,246,0.2)]'
          : 'border-violet-400/60 hover:border-violet-300'
        }
        shadow-elevation-2 min-w-[160px] transition-all
      `}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-violet-400 !border-2 !border-background !rounded-full"
      />

      <div className="flex items-center gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-card flex items-center justify-center bg-violet-500/15">
          <GitBranch className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-violet-400/70 font-medium">Condition</span>
          <span className="text-xs font-semibold text-foreground truncate">{d.conditionLabel || 'Route'}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 mt-1 ml-1">
        {branches.map((branch) => (
          <div key={branch.id} className="flex items-center gap-2 relative">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: branch.color }}
            />
            <span className="text-[10px] text-foreground">{branch.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={`branch-${branch.id}`}
              className="!w-2.5 !h-2.5 !border-2 !border-background !rounded-full"
              style={{
                backgroundColor: branch.color,
                top: 'auto',
                right: -14,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const ConditionGateNode = memo(ConditionGateNodeInner);
