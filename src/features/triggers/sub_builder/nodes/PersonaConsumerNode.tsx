import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaConsumerNodeData } from '../libs/eventCanvasReconcile';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-muted-foreground/40',
  running: 'bg-cyan-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
};

function PersonaConsumerNodeInner({ data, selected, id: _id }: NodeProps) {
  const d = data as PersonaConsumerNodeData;
  const statusDot = d.executionStatus ? STATUS_COLORS[d.executionStatus] ?? STATUS_COLORS.idle : STATUS_COLORS.idle;
  const isConnectTarget = (d as Record<string, unknown>)._connectTarget === true;

  return (
    <div
      className={`
        relative flex items-center gap-2.5 px-3 py-2.5 rounded-modal
        bg-card backdrop-blur border-2
        ${isConnectTarget
          ? 'border-amber-400 ring-2 ring-amber-400/30 shadow-[0_0_16px_rgba(251,191,36,0.25)]'
          : selected
            ? 'border-emerald-400 ring-2 ring-emerald-400/25 shadow-[0_0_16px_rgba(52,211,153,0.2)]'
            : 'border-emerald-400/70 hover:border-emerald-300'
        }
        ${!d.enabled ? 'opacity-50' : ''}
        shadow-elevation-2 min-w-[160px] transition-all
      `}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-background !rounded-full"
      />

      <div className="flex-shrink-0 icon-frame icon-frame-pop bg-emerald-500/15">
        <PersonaIcon icon={d.icon} color={d.color} size="w-4 h-4" framed frameSize={"lg"} />
      </div>

      <div className="flex flex-col min-w-0">
        <span className="typo-caption font-semibold text-foreground truncate">{d.name}</span>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className="text-[10px] text-foreground">
            {d.executionStatus === 'running' ? 'Running' :
              d.lastExecutionAt ? `Last: ${new Date(d.lastExecutionAt).toLocaleTimeString()}` :
                'No executions'}
          </span>
        </div>
      </div>

      {d.connectedEventCount > 0 && (
        <span className="absolute -top-2 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[9px] font-bold text-white shadow">
          {d.connectedEventCount}
        </span>
      )}
    </div>
  );
}

export const PersonaConsumerNode = memo(PersonaConsumerNodeInner);
