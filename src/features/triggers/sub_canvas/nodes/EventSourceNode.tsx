import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Clock, Globe, Webhook, Link, Radio, Eye, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
  type LucideIcon,
} from 'lucide-react';
import type { EventSourceNodeData } from '../libs/eventCanvasReconcile';

const ICON_MAP: Record<string, LucideIcon> = {
  Clock, Globe, Webhook, Link, Radio, Eye, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
};

function EventSourceNodeInner({ data, selected }: NodeProps) {
  const d = data as EventSourceNodeData;
  const Icon = ICON_MAP[d.iconName] ?? Zap;
  const count = d.liveEventCount ?? 0;

  return (
    <div
      className={`
        relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl
        bg-card/90 backdrop-blur
        border-[1.5px]
        ${selected
          ? 'border-cyan-400 ring-2 ring-cyan-400/20 shadow-[0_0_12px_rgba(34,211,238,0.15)]'
          : 'border-cyan-500/30 dark:border-cyan-400/40 hover:border-cyan-400/60'
        }
        shadow-sm min-w-[160px] transition-all
      `}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/8 ${d.color}`}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Label + event type */}
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-semibold text-foreground truncate">{d.label}</span>
        <span className="text-[10px] text-muted-foreground truncate">{d.eventType}</span>
      </div>

      {/* Live count badge */}
      {count > 0 && (
        <span className="absolute -top-2 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-cyan-500 text-[9px] font-bold text-white shadow animate-pulse">
          {count > 99 ? '99+' : count}
        </span>
      )}

      {/* Source handle (right side — events flow left to right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-cyan-400 !border-2 !border-background"
      />
    </div>
  );
}

export const EventSourceNode = memo(EventSourceNodeInner);
