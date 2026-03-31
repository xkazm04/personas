import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaStepNodeData } from '../libs/triggerStudioConstants';

function PersonaStepNodeInner({ data, selected }: NodeProps) {
  const d = data as PersonaStepNodeData;

  return (
    <div
      className={`
        relative flex items-center gap-2.5 px-3.5 py-3 rounded-xl
        bg-card backdrop-blur border-2
        ${selected
          ? 'border-emerald-400 ring-2 ring-emerald-400/25 shadow-[0_0_16px_rgba(52,211,153,0.2)]'
          : 'border-emerald-400/60 hover:border-emerald-300'
        }
        ${!d.enabled ? 'opacity-50' : ''}
        shadow-elevation-2 min-w-[170px] transition-all
      `}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-background !rounded-full"
      />

      <div className="flex-shrink-0 icon-frame-md icon-frame-pop bg-emerald-500/15">
        <PersonaIcon icon={d.icon} color={d.color} size="w-4.5 h-4.5" framed />
      </div>

      <div className="flex flex-col min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-medium">Persona</span>
        <span className="text-xs font-semibold text-foreground truncate">{d.name}</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="chain-out"
        className="!w-3 !h-3 !bg-indigo-400 !border-2 !border-background !rounded-full"
      />
    </div>
  );
}

export const PersonaStepNode = memo(PersonaStepNodeInner);
