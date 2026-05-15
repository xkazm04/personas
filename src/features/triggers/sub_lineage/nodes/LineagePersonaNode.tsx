import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import type { LineagePersonaNode as LineagePersonaNodeData } from '../libs/deriveLineageGraph';

interface NodeData {
  persona: LineagePersonaNodeData['persona'];
  inCycle: boolean;
  inBlastRadius: boolean;
  blastSeed: boolean;
  dimmed: boolean;
  triggerCount: number;
  downstreamCount: number;
  onClick: () => void;
}

function LineagePersonaNodeInner({ data, selected }: NodeProps) {
  const { t, tx } = useTranslation();
  const d = data as unknown as NodeData;
  const p = d.persona;

  let borderClass = 'border-emerald-400/60 hover:border-emerald-300';
  if (selected || d.blastSeed) borderClass = 'border-emerald-300 ring-2 ring-emerald-300/40';
  else if (d.inCycle) borderClass = 'border-red-400/80 hover:border-red-300';
  else if (d.inBlastRadius) borderClass = 'border-amber-400/80 hover:border-amber-300';

  return (
    <div
      onClick={d.onClick}
      className={`
        relative flex items-center gap-2.5 px-3.5 py-3 rounded-modal cursor-pointer
        bg-card backdrop-blur border-2 transition-all
        ${borderClass}
        ${d.dimmed ? 'opacity-30' : ''}
        ${!p.enabled ? 'opacity-60' : ''}
        shadow-elevation-2 min-w-[180px]
      `}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-emerald-400 !border-2 !border-background" />

      <PersonaIcon icon={p.icon ?? ''} color={p.color ?? 'text-emerald-400'} display="framed" frameSize="md" />

      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-medium">{t.triggers.lineage.node_persona_label}</span>
        <span className="typo-caption font-semibold text-foreground truncate">{p.name}</span>
        <span className="text-[10px] text-foreground/70">
          {tx(t.triggers.lineage.node_persona_summary, { triggers: d.triggerCount, downstream: d.downstreamCount })}
        </span>
      </div>

      {d.inCycle && (
        <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-[8px] uppercase tracking-wider text-red-400 font-semibold">
          {t.triggers.lineage.node_cycle_badge}
        </span>
      )}

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-indigo-400 !border-2 !border-background" />
    </div>
  );
}

export const LineagePersonaNode = memo(LineagePersonaNodeInner);
