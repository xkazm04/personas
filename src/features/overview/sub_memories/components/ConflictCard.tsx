import { useTranslation } from '@/i18n/useTranslation';
import { Check, GitMerge, ChevronDown, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import type { MemoryConflict, ConflictResolution } from '../libs/memoryConflicts';
import { kindBadge, similarityBadge } from '../libs/conflictHelpers';

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
    <div className={`rounded-card border ${borderCls} overflow-hidden`}>
      <div className={`px-2.5 py-1.5 typo-caption ${headerCls} bg-secondary/30 border-b ${borderCls} flex items-center justify-between`}>
        <span>{label}</span>
        <span className="flex items-center gap-1 text-foreground">
          <PersonaIcon icon={null} color={null} display="pop" frameSize="lg" />
          {agentName}
        </span>
      </div>
      <div className="px-2.5 py-2 space-y-1">
        <p className="typo-caption text-foreground line-clamp-2">{stripHtml(memory.title)}</p>
        <p className="typo-caption text-foreground line-clamp-3 whitespace-pre-wrap">{stripHtml(memory.content)}</p>
        <div className="flex items-center gap-2 typo-caption text-foreground pt-0.5">
          <span className="px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/10 typo-caption">{memory.category}</span>
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
  const { t } = useTranslation();
  const nameA = personaMap.get(conflict.memoryA.persona_id) ?? 'Unknown';
  const nameB = personaMap.get(conflict.memoryB.persona_id) ?? 'Unknown';

  return (
    <div className={`rounded-modal border transition-colors ${isActive ? 'border-primary/25 bg-secondary/30' : 'border-primary/10 bg-background/30'}`}>
      <button type="button" onClick={onToggle} disabled={isProcessing} title={isProcessing ? 'Processing resolution...' : undefined} className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer disabled:opacity-50">
        {kindBadge(conflict.kind)}
        <span className="typo-body text-foreground flex-1 truncate">
          {stripHtml(conflict.memoryA.title)}
          <span className="text-foreground mx-1.5">vs</span>
          {stripHtml(conflict.memoryB.title)}
        </span>
        {similarityBadge(conflict.similarity)}
        <ChevronDown className={`w-3.5 h-3.5 text-foreground flex-shrink-0 transition-transform ${isActive ? 'rotate-180' : ''}`} />
      </button>

      {isActive && (
        <div className="animate-fade-slide-in overflow-hidden">
          <div className="px-3 pb-3 space-y-3 border-t border-primary/10 pt-3">
            <p className="typo-caption text-foreground">{conflict.reason}</p>
            <div className="grid grid-cols-2 gap-2">
              <MemoryPreview label={t.overview.memory_conflict.memory_a} memory={conflict.memoryA} agentName={nameA} accent="blue" />
              <MemoryPreview label={t.overview.memory_conflict.memory_b} memory={conflict.memoryB} agentName={nameB} accent="amber" />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {conflict.kind === 'duplicate' && (
                <Button variant="accent" accentColor="indigo" size="xs" icon={<GitMerge className="w-3 h-3" />} disabled={isProcessing} disabledReason="Processing resolution..." onClick={() => onResolve('merge')}>{t.overview.memory_conflict.merge}</Button>
              )}
              <Button variant="accent" accentColor="emerald" size="xs" icon={<Check className="w-3 h-3" />} disabled={isProcessing} disabledReason="Processing resolution..." onClick={() => onResolve('keep_a')}>
                Keep &ldquo;{stripHtml(conflict.memoryA.title).slice(0, 20)}...&rdquo;
              </Button>
              <Button variant="accent" accentColor="emerald" size="xs" icon={<Check className="w-3 h-3" />} disabled={isProcessing} disabledReason="Processing resolution..." onClick={() => onResolve('keep_b')}>
                Keep &ldquo;{stripHtml(conflict.memoryB.title).slice(0, 20)}...&rdquo;
              </Button>
              <Button variant="secondary" size="xs" icon={<X className="w-3 h-3" />} disabled={isProcessing} disabledReason="Processing resolution..." onClick={() => onResolve('dismiss')}>{t.common.dismiss}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
