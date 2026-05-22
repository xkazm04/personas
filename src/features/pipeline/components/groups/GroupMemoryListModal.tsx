import { useEffect, useState } from 'react';
import { Brain, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { listGroupMemories } from '@/api/overview/memories';
import { silentCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

interface GroupMemoryListModalProps {
  open: boolean;
  group: PersonaGroup;
  onClose: () => void;
}

export function GroupMemoryListModal({ open, group, onClose }: GroupMemoryListModalProps) {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [memories, setMemories] = useState<PersonaMemory[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listGroupMemories(group.id)
      .then((rows) => setMemories(rows))
      .catch((err) => {
        silentCatch('features/pipeline/components/groups/GroupMemoryListModal:fetch')(err);
        setMemories([]);
      })
      .finally(() => setLoading(false));
  }, [open, group.id]);

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="group-memory-list-title"
      size="lg"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[80vh]"
    >
      <div
        className="px-5 pt-5 pb-3 border-b border-primary/10 flex items-center justify-between"
        style={{ borderLeft: `3px solid ${colorWithAlpha(group.color || '#6366f1', 0.8)}` }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Brain className="w-4 h-4 text-foreground/70 flex-shrink-0" />
          <h2 id="group-memory-list-title" className="typo-heading font-semibold text-foreground/90 truncate">
            {tx(t.pipeline.groups.memory_modal_title, { name: group.name })}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && (
          <p className="typo-body text-foreground text-center py-6">
            {t.pipeline.groups.memory_modal_loading}
          </p>
        )}
        {!loading && memories && memories.length === 0 && (
          <div className="text-center py-8">
            <Brain className="w-8 h-8 mx-auto text-foreground/30 mb-3" />
            <p className="typo-heading text-foreground/90 mb-1">
              {t.pipeline.groups.memory_modal_empty_title}
            </p>
            <p className="typo-body text-foreground max-w-md mx-auto">
              {t.pipeline.groups.memory_modal_empty_hint}
            </p>
          </div>
        )}
        {!loading && memories && memories.length > 0 && (
          <ul className="space-y-2.5">
            {memories.map((m) => {
              const author = personas.find((p) => p.id === m.persona_id);
              return (
                <li
                  key={m.id}
                  className="p-3 rounded-card bg-secondary/30 border border-primary/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="typo-heading text-foreground/90 font-semibold truncate">
                          {m.title}
                        </h3>
                        <span className="typo-label text-foreground/60 uppercase tracking-wider">
                          {m.category}
                        </span>
                        {m.tier && m.tier !== 'active' && (
                          <span className="typo-label text-foreground/60 uppercase tracking-wider">
                            {m.tier}
                          </span>
                        )}
                      </div>
                      <p className="typo-body text-foreground whitespace-pre-wrap line-clamp-4">
                        {m.content}
                      </p>
                      <div className="mt-2 flex items-center gap-3 typo-caption text-foreground/60">
                        {author && (
                          <span>
                            {tx(t.pipeline.groups.memory_modal_authored_by, { name: author.name })}
                          </span>
                        )}
                        <span>
                          {tx(t.pipeline.groups.memory_modal_importance, { value: m.importance })}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-between">
        <p className="typo-caption text-foreground/60">
          {!loading && memories
            ? tx(
                memories.length === 1
                  ? t.pipeline.groups.memory_modal_footer_count_one
                  : t.pipeline.groups.memory_modal_footer_count_other,
                { count: memories.length },
              )
            : ''}
        </p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t.common.close}
        </Button>
      </div>
    </BaseModal>
  );
}
