import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, FileEdit, Zap, AlertOctagon, RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { getTriggerTypeLabel } from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  schedule: Clock,
  polling: Globe,
  webhook: Webhook,
  chain: Link,
  event_listener: Radio,
  file_watcher: FileEdit,
  clipboard: Clipboard,
  app_focus: AppWindow,
  composite: Layers,
};

interface NodeData {
  trigger: PersonaTrigger;
  eventType: string | null;
  isOrphan: boolean;
  inCycle: boolean;
  inBlastRadius: boolean;
  dimmed: boolean;
}

function LineageTriggerNodeInner({ data, selected }: NodeProps) {
  const { t: tr } = useTranslation();
  const d = data as unknown as NodeData;
  const t = d.trigger;
  const Icon = ICON_BY_TYPE[t.trigger_type] ?? Zap;

  let borderClass = 'border-amber-400/60';
  if (selected) borderClass = 'border-amber-300 ring-2 ring-amber-300/40';
  else if (d.inCycle) borderClass = 'border-red-400/80';
  else if (d.isOrphan) borderClass = 'border-foreground/30 border-dashed';
  else if (d.inBlastRadius) borderClass = 'border-amber-300/80';

  return (
    <div
      className={`
        relative flex items-center gap-2 px-2.5 py-2 rounded-card
        bg-card backdrop-blur border-2 transition-all
        ${borderClass}
        ${d.dimmed ? 'opacity-30' : ''}
        ${!t.enabled ? 'opacity-50' : ''}
        shadow-elevation-1 min-w-[150px]
      `}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-400 !border-2 !border-background" />

      <div className={`flex-shrink-0 w-7 h-7 rounded-input flex items-center justify-center bg-amber-500/15 text-amber-400`}>
        <Icon className="w-3.5 h-3.5" />
      </div>

      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[9px] uppercase tracking-wider text-amber-400/70 font-medium">
          {getTriggerTypeLabel(t.trigger_type)}
        </span>
        {d.eventType && (
          <span className="text-[10px] font-mono text-foreground truncate">{d.eventType}</span>
        )}
      </div>

      {d.isOrphan && (
        <span title={tr.triggers.lineage.node_orphan_tooltip} className="flex-shrink-0">
          <AlertOctagon className="w-3 h-3 text-foreground" />
        </span>
      )}
      {d.inCycle && (
        <span title={tr.triggers.lineage.node_cycle_tooltip} className="flex-shrink-0">
          <RefreshCw className="w-3 h-3 text-red-400" />
        </span>
      )}

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-emerald-400 !border-2 !border-background" />
    </div>
  );
}

export const LineageTriggerNode = memo(LineageTriggerNodeInner);
