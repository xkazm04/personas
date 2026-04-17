import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, FileEdit, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { TriggerSourceNodeData } from '../libs/triggerStudioConstants';
import { getTriggerTypeLabel } from '@/lib/utils/platform/triggerConstants';

const ICON_MAP: Record<string, LucideIcon> = {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, FileEdit, Zap,
};

function TriggerSourceNodeInner({ data, selected }: NodeProps) {
  const d = data as TriggerSourceNodeData;
  const Icon = ICON_MAP[d.iconName] ?? Zap;

  return (
    <div
      className={`
        relative flex items-center gap-2.5 px-3.5 py-3 rounded-modal
        bg-card backdrop-blur border-2
        ${selected
          ? 'border-amber-400 ring-2 ring-amber-400/25 shadow-[0_0_16px_rgba(251,191,36,0.2)]'
          : 'border-amber-400/60 hover:border-amber-300'
        }
        shadow-elevation-2 min-w-[170px] transition-all
      `}
    >
      <div className={`flex-shrink-0 w-9 h-9 rounded-card flex items-center justify-center bg-amber-500/15 ${d.color}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>

      <div className="flex flex-col min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-amber-400/70 font-medium">Trigger</span>
        <span className="text-xs font-semibold text-foreground truncate">{d.label}</span>
        <span className="text-[10px] text-muted-foreground truncate">{getTriggerTypeLabel(d.triggerType)}</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-amber-400 !border-2 !border-background !rounded-full"
      />
    </div>
  );
}

export const TriggerSourceNode = memo(TriggerSourceNodeInner);
