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

function EventSourceNodeInner({ data, selected, id: _id }: NodeProps) {
  const d = data as EventSourceNodeData;
  const Icon = ICON_MAP[d.iconName] ?? Zap;
  const count = d.liveEventCount ?? 0;
  const isConnectSource = (d as Record<string, unknown>)._connectSource === true;

  return (
    <div
      className={`
        relative flex items-center gap-2.5 px-3 py-2.5 rounded-modal
        bg-card backdrop-blur border-2
        ${isConnectSource
          ? 'border-amber-400 ring-2 ring-amber-400/30 shadow-[0_0_16px_rgba(251,191,36,0.25)]'
          : selected
            ? 'border-cyan-400 ring-2 ring-cyan-400/25 shadow-[0_0_16px_rgba(34,211,238,0.2)]'
            : 'border-cyan-400/70 hover:border-cyan-300'
        }
        shadow-elevation-2 min-w-[160px] transition-all
      `}
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-card flex items-center justify-center bg-cyan-500/15 ${d.color}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex flex-col min-w-0">
        <span className="text-xs font-semibold text-foreground truncate">{d.label}</span>
        <span className="text-[10px] text-muted-foreground truncate">{d.eventType}</span>
      </div>

      {count > 0 && (
        <span className="absolute -top-2 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-cyan-500 text-[9px] font-bold text-white shadow animate-pulse">
          {count > 99 ? '99+' : count}
        </span>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-cyan-400 !border-2 !border-background !rounded-full"
      />
    </div>
  );
}

export const EventSourceNode = memo(EventSourceNodeInner);
