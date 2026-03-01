import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { Check, AlertTriangle, Sparkles, CircleDot } from 'lucide-react';
import { ROLE_COLORS, PersonaAvatar } from './teamConstants';

interface PersonaNodeData {
  name: string;
  icon: string;
  color: string;
  role: string;
  memberId: string;
  personaId: string;
  pipelineStatus?: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  edgeCount?: number;
  [key: string]: unknown;
}

function getPipelineStyles(status?: string, selected?: boolean): string {
  switch (status) {
    case 'queued':
      return 'border-amber-500/50 shadow-[0_0_16px_rgba(245,158,11,0.3)] animate-pulse';
    case 'running':
      return 'border-cyan-500/50 shadow-[0_0_16px_rgba(6,182,212,0.3)]';
    case 'completed':
      return 'border-emerald-500/50 shadow-[0_0_16px_rgba(16,185,129,0.4)]';
    case 'failed':
      return 'border-red-500/50 border-dashed shadow-[0_0_16px_rgba(239,68,68,0.3)]';
    default:
      return selected
        ? 'border-indigo-500/50 shadow-[0_0_16px_rgba(99,102,241,0.15)]'
        : 'border-primary/15 hover:border-primary/25';
  }
}

function PersonaNodeComponent({ data, selected }: NodeProps) {
  const d = data as PersonaNodeData;
  const name = d.name || 'Agent';
  const icon = d.icon || '';
  const color = d.color || '#6366f1';
  const role = d.role || 'worker';
  const pipelineStatus = d.pipelineStatus;
  const dryRunStatus = d.dryRunStatus as string | undefined;
  const hasBreakpoint = d.hasBreakpoint as boolean | undefined;
  const hasOptimizerSuggestion = d.hasOptimizerSuggestion as boolean | undefined;
  const isGhost = d.isGhost as boolean | undefined;
  const edgeCount = (d.edgeCount as number) ?? 0;
  const showHandleGlow = edgeCount < 2 && !isGhost;
  const defaultRole = { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' };
  const roleDef = ROLE_COLORS[role] ?? defaultRole;

  // Dry-run status takes priority when active
  const effectiveStatus = dryRunStatus || pipelineStatus;
  const borderStyles = getPipelineStyles(effectiveStatus, selected);

  const handleGlowAnimation = showHandleGlow
    ? {
        boxShadow: [
          '0 0 0 0 rgba(99,102,241,0)',
          '0 0 0 4px rgba(99,102,241,0.15)',
          '0 0 0 0 rgba(99,102,241,0)',
        ],
      }
    : undefined;

  const handleGlowTransition = showHandleGlow
    ? { duration: 2, repeat: Infinity, ease: 'easeInOut' as const }
    : undefined;

  return (
    <div
      className={`group relative px-4 py-3 rounded-xl bg-secondary/60 backdrop-blur-sm border transition-all min-w-[160px] ${
        isGhost
          ? 'opacity-40 border-dashed border-indigo-500/40 pointer-events-none'
          : `cursor-grab active:cursor-grabbing hover:shadow-lg hover:shadow-indigo-500/10 ${borderStyles}`
      }`}
    >
      {/* Running spin-ring overlay */}
      {effectiveStatus === 'running' && (
        <div
          className="absolute inset-[-3px] rounded-xl border-2 border-transparent border-t-blue-400 pointer-events-none"
          style={{ animation: 'spin-ring 1.5s linear infinite' }}
        />
      )}

      {/* Completed checkmark */}
      {effectiveStatus === 'completed' && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center z-10">
          <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
        </div>
      )}

      {/* Failed warning */}
      {effectiveStatus === 'failed' && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center z-10">
          <AlertTriangle className="w-3 h-3 text-foreground" strokeWidth={3} />
        </div>
      )}

      {/* Breakpoint indicator */}
      {hasBreakpoint && (
        <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-red-600 flex items-center justify-center z-10">
          <CircleDot className="w-3 h-3 text-red-200" strokeWidth={3} />
        </div>
      )}

      {/* Optimizer suggestion indicator */}
      {hasOptimizerSuggestion && !effectiveStatus && (
        <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-indigo-500/90 flex items-center justify-center z-10 animate-pulse">
          <Sparkles className="w-2.5 h-2.5 text-foreground" strokeWidth={2.5} />
        </div>
      )}

      <motion.div
        className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full"
        animate={handleGlowAnimation}
        transition={handleGlowTransition}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3.5 !h-3.5 !rounded-full !border-2 !border-indigo-500/40 !bg-background group-hover:!scale-150 group-hover:!border-indigo-400 !transition-transform"
        />
      </motion.div>

      <div className="flex items-center gap-2.5">
        <PersonaAvatar icon={icon} color={color} />

        {/* Info */}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground/90 truncate max-w-[140px]" title={name}>
            {name}
          </div>
          <div className={`inline-flex items-center mt-0.5 px-1.5 py-0.5 text-sm font-mono uppercase rounded-md border ${roleDef.bg} ${roleDef.text} ${roleDef.border}`}>
            {role}
          </div>
        </div>
      </div>

      <motion.div
        className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 rounded-full"
        animate={handleGlowAnimation}
        transition={handleGlowTransition}
      >
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3.5 !h-3.5 !rounded-full !border-2 !border-indigo-500/40 !bg-background group-hover:!scale-150 group-hover:!border-indigo-400 !transition-transform"
        />
      </motion.div>
    </div>
  );
}

export default memo(PersonaNodeComponent);
