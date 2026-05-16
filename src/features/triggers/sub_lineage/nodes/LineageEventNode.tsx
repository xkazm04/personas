import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Radio } from 'lucide-react';

interface NodeData {
  eventType: string;
  dimmed: boolean;
}

function LineageEventNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as NodeData;

  return (
    <div
      className={`
        relative flex items-center gap-2 px-2.5 py-1.5 rounded-input
        bg-cyan-500/10 backdrop-blur border transition-all
        ${selected ? 'border-cyan-300 ring-2 ring-cyan-300/40' : 'border-cyan-400/40'}
        ${d.dimmed ? 'opacity-30' : ''}
        min-w-[120px]
      `}
    >
      <Radio className="w-3 h-3 text-cyan-400 flex-shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-[8px] uppercase tracking-wider text-cyan-400/70 font-medium">Event</span>
        <span className="text-[10px] font-mono text-foreground/90 truncate">{d.eventType}</span>
      </div>

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-cyan-400 !border-2 !border-background" />
    </div>
  );
}

export const LineageEventNode = memo(LineageEventNodeInner);
