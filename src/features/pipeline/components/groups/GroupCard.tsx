import { memo } from 'react';
import { Pencil, Trash2, Users } from 'lucide-react';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useTranslation } from '@/i18n/useTranslation';

interface GroupCardProps {
  group: PersonaGroup;
  personaCount: number;
  confirmDeleteId: string | null;
  onEdit: (group: PersonaGroup) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
}

export const GroupCard = memo(function GroupCard({
  group,
  personaCount,
  confirmDeleteId,
  onEdit,
  onDelete,
  onConfirmDelete,
}: GroupCardProps) {
  const { t, tx } = useTranslation();
  const color = group.color || '#6366f1';
  return (
    <div
      key={group.id}
      className="animate-fade-slide-in group relative p-4 rounded-modal bg-secondary/40 backdrop-blur-sm border border-primary/15 hover:border-indigo-500/30 transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.08)]"
    >
      <div
        className="absolute top-0 left-4 right-4 h-[2px] rounded-full opacity-60"
        style={{ backgroundColor: color }}
      />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="w-10 h-10 rounded-modal flex items-center justify-center border flex-shrink-0"
            style={{
              backgroundColor: colorWithAlpha(color, 0.08),
              borderColor: colorWithAlpha(color, 0.19),
            }}
          >
            <Users className="w-5 h-5" style={{ color: colorWithAlpha(color, 0.8) }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="typo-heading font-semibold text-foreground/90 truncate">{group.name}</h3>
            {group.description && (
              <p className="typo-body text-foreground mt-0.5 line-clamp-1">{group.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onEdit(group)}
            title={t.pipeline.groups.edit_group}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-card hover:bg-indigo-500/15 text-foreground hover:text-indigo-400 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {confirmDeleteId === group.id ? (
            <div className="animate-fade-slide-in flex items-center gap-1.5">
              <button
                onClick={() => onDelete(group.id)}
                className="px-2 py-1 rounded-card bg-red-500/15 text-red-300 hover:bg-red-500/25 typo-label"
              >
                {t.common.confirm}
              </button>
              <button
                onClick={() => onConfirmDelete(null)}
                className="px-2 py-1 rounded-card bg-secondary/40 text-foreground hover:bg-secondary/60 typo-label"
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <button
              onClick={() => onConfirmDelete(group.id)}
              title={t.pipeline.groups.delete_group}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-card hover:bg-red-500/15 text-foreground hover:text-red-400 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-foreground">
        <Users className="w-3.5 h-3.5 opacity-60" />
        <span className="typo-body">
          {tx(
            personaCount === 1
              ? t.pipeline.groups.persona_count_one
              : t.pipeline.groups.persona_count_other,
            { count: personaCount },
          )}
        </span>
        {group.sharedInstructions && (
          <span
            className="ml-auto inline-flex items-center gap-1 typo-label text-indigo-300/80"
            title={t.pipeline.groups.shared_instructions_title}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/60" />
            {t.pipeline.groups.shared_label}
          </span>
        )}
      </div>
    </div>
  );
});
