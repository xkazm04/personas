import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot } from 'lucide-react';
import type { PersonaConsumerNodeData } from '../libs/eventCanvasReconcile';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-muted-foreground/40',
  running: 'bg-cyan-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
};

function PersonaConsumerNodeInner({ data, selected }: NodeProps) {
  const d = data as PersonaConsumerNodeData;
  const statusDot = d.executionStatus ? STATUS_COLORS[d.executionStatus] ?? STATUS_COLORS.idle : STATUS_COLORS.idle;

  return (
    <div
      className={`
        relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl
        bg-card/90 backdrop-blur
        border-[1.5px]
        ${selected
          ? 'border-emerald-400 ring-2 ring-emerald-400/20 shadow-[0_0_12px_rgba(52,211,153,0.15)]'
          : 'border-emerald-500/30 dark:border-emerald-400/40 hover:border-emerald-400/60'
        }
        ${!d.enabled ? 'opacity-50' : ''}
        shadow-sm min-w-[160px] transition-all
      `}
    >
      {/* Target handle (left side) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-background"
      />

      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/8">
        {d.icon ? (
          <span className="text-sm">{d.icon}</span>
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      {/* Name + status */}
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-semibold text-foreground truncate">{d.name}</span>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className="text-[10px] text-muted-foreground">
            {d.executionStatus === 'running' ? 'Running' :
             d.lastExecutionAt ? `Last: ${new Date(d.lastExecutionAt).toLocaleTimeString()}` :
             'No executions'}
          </span>
        </div>
      </div>

      {/* Connected count badge */}
      {d.connectedEventCount > 0 && (
        <span className="absolute -top-2 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500/90 text-[9px] font-bold text-white shadow">
          {d.connectedEventCount}
        </span>
      )}
    </div>
  );
}

export const PersonaConsumerNode = memo(PersonaConsumerNodeInner);
