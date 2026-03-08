import { Check, GitMerge, ChevronDown, Bot, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { stripHtml } from '@/lib/utils/sanitizeHtml';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import type { MemoryConflict, ConflictResolution } from '../libs/memoryConflicts';
import { kindBadge, similarityBadge, VARIANT_STYLES } from '../libs/conflictHelpers';

// ---------------------------------------------------------------------------
// Resolution button
// ---------------------------------------------------------------------------

function ResolutionButton({
  icon: Icon,
  label,
  variant,
  disabled,
  onClick,
}: {
  icon: typeof Check;
  label: string;
  variant: keyof typeof VARIANT_STYLES;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 cursor-pointer ${VARIANT_STYLES[variant]}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Memory preview
// ---------------------------------------------------------------------------

function MemoryPreview({
  label,
  memory,
  agentName,
  accent,
}: {
  label: string;
  memory: PersonaMemory;
  agentName: string;
  accent: 'blue' | 'amber';
}) {
  const borderCls = accent === 'blue' ? 'border-blue-500/20' : 'border-amber-500/20';
  const headerCls = accent === 'blue' ? 'text-blue-400/80' : 'text-amber-400/80';

  return (
    <div className={`rounded-lg border ${borderCls} overflow-hidden`}>
      <div className={`px-2.5 py-1.5 text-xs font-medium ${headerCls} bg-secondary/30 border-b ${borderCls} flex items-center justify-between`}>
        <span>{label}</span>
        <span className="flex items-center gap-1 text-muted-foreground/60">
          <Bot className="w-3 h-3" />
          {agentName}
        </span>
      </div>
      <div className="px-2.5 py-2 space-y-1">
        <p className="text-xs font-medium text-foreground/80 line-clamp-2">{stripHtml(memory.title)}</p>
        <p className="text-xs text-muted-foreground/60 line-clamp-3 whitespace-pre-wrap">{stripHtml(memory.content)}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50 pt-0.5">
          <span className="px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/10 text-xs">{memory.category}</span>
          <span>{new Date(memory.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict card
// ---------------------------------------------------------------------------

interface ConflictCardProps {
  conflict: MemoryConflict;
  personaMap: Map<string, string>;
  isActive: boolean;
  isProcessing: boolean;
  onToggle: () => void;
  onResolve: (res: ConflictResolution) => void;
}

export default function ConflictCard({ conflict, personaMap, isActive, isProcessing, onToggle, onResolve }: ConflictCardProps) {
  const nameA = personaMap.get(conflict.memoryA.persona_id) ?? 'Unknown';
  const nameB = personaMap.get(conflict.memoryB.persona_id) ?? 'Unknown';

  return (
    <div className={`rounded-xl border transition-colors ${isActive ? 'border-primary/25 bg-secondary/30' : 'border-primary/10 bg-background/30'}`}>
      <button type="button" onClick={onToggle} disabled={isProcessing} className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer disabled:opacity-50">
        {kindBadge(conflict.kind)}
        <span className="text-sm text-foreground/80 flex-1 truncate">
          {stripHtml(conflict.memoryA.title)}
          <span className="text-muted-foreground/40 mx-1.5">vs</span>
          {stripHtml(conflict.memoryB.title)}
        </span>
        {similarityBadge(conflict.similarity)}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${isActive ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isActive && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-3 border-t border-primary/10 pt-3">
              <p className="text-xs text-muted-foreground/70">{conflict.reason}</p>
              <div className="grid grid-cols-2 gap-2">
                <MemoryPreview label="Memory A" memory={conflict.memoryA} agentName={nameA} accent="blue" />
                <MemoryPreview label="Memory B" memory={conflict.memoryB} agentName={nameB} accent="amber" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {conflict.kind === 'duplicate' && (
                  <ResolutionButton icon={GitMerge} label="Merge" variant="primary" disabled={isProcessing} onClick={() => onResolve('merge')} />
                )}
                <ResolutionButton icon={Check} label={`Keep "${stripHtml(conflict.memoryA.title).slice(0, 20)}..."`} variant="success" disabled={isProcessing} onClick={() => onResolve('keep_a')} />
                <ResolutionButton icon={Check} label={`Keep "${stripHtml(conflict.memoryB.title).slice(0, 20)}..."`} variant="success" disabled={isProcessing} onClick={() => onResolve('keep_b')} />
                <ResolutionButton icon={X} label="Dismiss" variant="muted" disabled={isProcessing} onClick={() => onResolve('dismiss')} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
