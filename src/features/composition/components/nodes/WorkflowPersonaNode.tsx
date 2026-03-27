import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot, ArrowDownToLine, ArrowUpFromLine, Check, AlertTriangle, Loader2 } from 'lucide-react';
import type { WorkflowNodeKind, WorkflowNodeStatus } from '@/lib/types/compositionTypes';
import { PersonaAvatar } from '@/features/pipeline/sub_canvas/libs/teamConstants';

interface WorkflowNodeData {
  kind: WorkflowNodeKind;
  label: string;
  personaId?: string;
  personaIcon?: string;
  personaColor?: string;
  executionStatus?: WorkflowNodeStatus;
  [key: string]: unknown;
}

const statusStyles: Record<string, string> = {
  pending: 'border-primary/15',
  queued: 'border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.2)] animate-pulse',
  running: 'border-cyan-500/50 shadow-[0_0_14px_rgba(6,182,212,0.25)]',
  completed: 'border-emerald-500/50 shadow-[0_0_14px_rgba(16,185,129,0.3)]',
  failed: 'border-red-500/50 border-dashed shadow-[0_0_14px_rgba(239,68,68,0.25)]',
  skipped: 'border-muted-foreground/30 opacity-50',
};

const kindMeta: Record<WorkflowNodeKind, { icon: typeof Bot; color: string; label: string }> = {
  persona: { icon: Bot, color: '#6366f1', label: 'Persona' },
  input: { icon: ArrowDownToLine, color: '#3b82f6', label: 'Input' },
  output: { icon: ArrowUpFromLine, color: '#10b981', label: 'Output' },
};

function StatusBadge({ status }: { status?: WorkflowNodeStatus }) {
  if (!status || status === 'pending') return null;
  if (status === 'running') return (
    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center z-10">
      <Loader2 className="w-3 h-3 text-white animate-spin" strokeWidth={3} />
    </div>
  );
  if (status === 'completed') return (
    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center z-10">
      <Check className="w-3 h-3 text-white" strokeWidth={3} />
    </div>
  );
  if (status === 'failed') return (
    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center z-10">
      <AlertTriangle className="w-3 h-3 text-white" strokeWidth={3} />
    </div>
  );
  return null;
}

function WorkflowPersonaNodeComponent({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const kind = d.kind || 'persona';
  const meta = kindMeta[kind];
  const label = d.label || meta.label;
  const status = d.executionStatus;
  const border = status ? (statusStyles[status] ?? statusStyles.pending) : (selected ? 'border-indigo-500/50 shadow-[0_0_14px_rgba(99,102,241,0.15)]' : 'border-primary/15 hover:border-primary/25');

  const showSource = kind !== 'output';
  const showTarget = kind !== 'input';

  return (
    <div
      className={`group relative px-4 py-3 rounded-xl bg-secondary/60 backdrop-blur-sm border transition-all min-w-[160px] cursor-grab active:cursor-grabbing hover:shadow-elevation-3 hover:shadow-indigo-500/10 ${border}`}
    >
      {status === 'running' && (
        <div
          className="absolute inset-[-3px] rounded-xl border-2 border-transparent border-t-cyan-400 pointer-events-none"
          style={{ animation: 'spin-ring 1.5s linear infinite' }}
        />
      )}

      <StatusBadge status={status} />

      {showTarget && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3.5 !h-3.5 !rounded-full !border-2 !border-indigo-500/40 !bg-background group-hover:!scale-150 group-hover:!border-indigo-400 !transition-transform"
        />
      )}

      <div className="flex items-center gap-2.5">
        {kind === 'persona' && d.personaIcon ? (
          <PersonaAvatar icon={d.personaIcon} color={d.personaColor} size="sm" />
        ) : (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center border"
            style={{ backgroundColor: `${meta.color}20`, borderColor: `${meta.color}40` }}
          >
            <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
          </div>
        )}

        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground/90 truncate max-w-[140px]" title={label}>
            {label}
          </div>
          <div className="text-[10px] font-mono uppercase text-muted-foreground/70 mt-0.5">
            {kind}
          </div>
        </div>
      </div>

      {showSource && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3.5 !h-3.5 !rounded-full !border-2 !border-indigo-500/40 !bg-background group-hover:!scale-150 group-hover:!border-indigo-400 !transition-transform"
        />
      )}
    </div>
  );
}

export default memo(WorkflowPersonaNodeComponent);
