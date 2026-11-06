import { useEffect } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';
import { X, Tag, ExternalLink, Layers } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import type { PersonaMemory } from '@/lib/types/types';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';

import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { ImportanceBar } from './MemoryCard';
import { MemoryClaimsSection } from './MemoryClaimsSection';
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

  // Both call sites mount this conditionally (`{selected && <MemoryDetailModal/>}`),
  // so BaseModal's own focus restore — which fires on the isOpen true→false
  // transition — never runs: the component simply unmounts. Capture the opener
  // on mount (before BaseModal's rAF moves focus into the panel) and hand focus
  // back on unmount, so the row that opened the modal keeps the keyboard.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="memory-detail-title"
      maxWidthClass="max-w-2xl"
      staggerChildren={false}
      panelClassName="bg-background border border-hair rounded-card shadow-elevation-4 overflow-hidden"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hair bg-surface-1">
          <div className="flex items-center gap-3 min-w-0">
            <PersonaIcon icon={null} color={personaColor} display="framed" frameSize={"lg"}
              frameStyle={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }} />
            <div className="min-w-0">
              <h3 id="memory-detail-title" className="typo-heading text-ink-2 truncate">{personaName}</h3>
              <span className="typo-caption text-ink-2">{formatRelativeTime(memory.created_at)}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Title */}
          <div>
            <div className="typo-eyebrow mb-1">{t.overview.memory_detail.title_label}</div>
            <p className="typo-heading text-ink-2">{stripHtml(memory.title)}</p>
          </div>

          {/* Content */}
          <div>
            <div className="typo-eyebrow mb-1">{t.overview.memory_detail.content_label}</div>
            <p className="typo-body text-foreground whitespace-pre-wrap">{stripHtml(memory.content)}</p>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="typo-eyebrow mb-1">{t.overview.memory_detail.category_label}</div>
              <CategoryChip category={memory.category} />
            </div>
            <div>
              <div className="typo-eyebrow mb-1">{t.overview.memory_detail.importance_label}</div>
              <ImportanceBar value={memory.importance} />
            </div>
            {memory.use_case_id && (
              <div>
                <div className="typo-eyebrow mb-1">Scope</div>
                <Tooltip content={`Capability: ${memory.use_case_id}`}><span
                  className="inline-flex items-center gap-1.5 typo-code text-ink-2"
                >
                  <Layers className="w-3 h-3 text-role-agent" />
                  <span className="max-w-[140px] truncate">{memory.use_case_id}</span>
                </span></Tooltip>
              </div>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <div className="typo-eyebrow mb-1.5">{t.overview.memory_detail.tags_label}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tag className="w-3 h-3 text-ink-3" />
                {tags.map((tag) => (
                  <span key={tag} className="typo-code text-ink-2 border-b border-hair">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Reflection provenance — which memories this insight was synthesized from */}
          {memory.derived_from && memory.derived_from.length > 0 && (
            <div>
              <div className="typo-eyebrow mb-1.5">{t.overview.memory_detail.derived_from_label}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Layers className="w-3 h-3 text-status-warning" />
                {memory.derived_from.map((sourceId) => (
                  <Tooltip content={sourceId}><span
                    key={sourceId}
                    className="typo-code text-ink-2 border-b border-hair"
                  >
                    {sourceId.slice(0, 8)}
                  </span></Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* Dispute claims (P3) — file wrong/outdated, resolve open disputes */}
          <MemoryClaimsSection memoryId={memory.id} />

          {/* Source execution link */}
          {memory.source_execution_id && (
            <Button variant="ghost" size="sm" onClick={() => { useAgentStore.getState().selectPersona(memory.persona_id); useSystemStore.getState().setEditorTab('use-cases'); onClose(); }} tooltip={`Execution: ${memory.source_execution_id}`} icon={<ExternalLink className="w-3 h-3" />}>
{t.overview.memory_detail.view_source_execution}
</Button>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-hair bg-surface-1">
          <Button variant="danger" size="sm" onClick={() => { onDelete(); onClose(); }}>
            {t.overview.memory_detail.delete_memory}
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
    </BaseModal>
  );
}
