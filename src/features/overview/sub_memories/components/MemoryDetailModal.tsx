import { X, Tag, ExternalLink, Layers } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaMemory } from '@/lib/types/types';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';

import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { ImportanceBar } from './MemoryCard';
import { useTranslation } from '@/i18n/useTranslation';

function parseTags(tags: string[] | null): string[] {
  if (!tags) return [];
  return Array.isArray(tags) ? tags : [];
}

interface MemoryDetailModalProps {
  memory: PersonaMemory;
  personaName: string;
  personaColor: string;
  onClose: () => void;
  onDelete: () => void;
}

export default function MemoryDetailModal({
  memory, personaName, personaColor, onClose, onDelete,
}: MemoryDetailModalProps) {
  const { t } = useTranslation();
  const tags = parseTags(memory.tags);

  return (
    <div
      className="animate-fade-slide-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-fade-slide-in bg-background border border-primary/15 rounded-2xl shadow-elevation-4 w-full max-w-2xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-secondary/20">
          <div className="flex items-center gap-3 min-w-0">
            <PersonaIcon icon={null} color={personaColor} display="framed" frameSize={"lg"}
              frameStyle={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }} />
            <div className="min-w-0">
              <h3 className="typo-heading text-foreground/90 truncate">{personaName}</h3>
              <span className="typo-caption text-foreground">{formatRelativeTime(memory.created_at)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Title */}
          <div>
            <div className="typo-code font-mono text-foreground uppercase tracking-wider mb-1">{t.overview.memory_detail.title_label}</div>
            <p className="typo-heading text-foreground/90">{stripHtml(memory.title)}</p>
          </div>

          {/* Content */}
          <div>
            <div className="typo-code font-mono text-foreground uppercase tracking-wider mb-1">{t.overview.memory_detail.content_label}</div>
            <p className="typo-body text-foreground leading-relaxed whitespace-pre-wrap">{stripHtml(memory.content)}</p>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="typo-code font-mono text-foreground uppercase tracking-wider mb-1">{t.overview.memory_detail.category_label}</div>
              <CategoryChip category={memory.category} />
            </div>
            <div>
              <div className="typo-code font-mono text-foreground uppercase tracking-wider mb-1">{t.overview.memory_detail.importance_label}</div>
              <ImportanceBar value={memory.importance} />
            </div>
            {memory.use_case_id && (
              <div>
                <div className="typo-code font-mono text-foreground uppercase tracking-wider mb-1">Scope</div>
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 typo-body"
                  title={`Capability: ${memory.use_case_id}`}
                >
                  <Layers className="w-3 h-3" />
                  <span className="max-w-[140px] truncate">{memory.use_case_id}</span>
                </span>
              </div>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <div className="typo-code font-mono text-foreground uppercase tracking-wider mb-1.5">{t.overview.memory_detail.tags_label}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tag className="w-3 h-3 text-foreground" />
                {tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 typo-code font-mono bg-secondary/40 text-foreground rounded border border-primary/10">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Source execution link */}
          {memory.source_execution_id && (
            <button
              onClick={() => { useAgentStore.getState().selectPersona(memory.persona_id); useSystemStore.getState().setEditorTab('use-cases'); onClose(); }}
              className="inline-flex items-center gap-1.5 typo-caption text-blue-400/70 hover:text-blue-400 transition-colors"
              title={`Execution: ${memory.source_execution_id}`}
            >
              <ExternalLink className="w-3 h-3" />
              {t.overview.memory_detail.view_source_execution}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-primary/10 bg-secondary/10">
          <button
            onClick={() => { onDelete(); onClose(); }}
            className="px-3 py-1.5 typo-caption rounded-card border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            {t.overview.memory_detail.delete_memory}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 typo-caption rounded-card border border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
