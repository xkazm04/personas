import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useState, useCallback, useMemo } from 'react';
import { History, ChevronUp } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { IMPORTANCE_DOTS, importanceToDots, dotsToImportance } from '../../libs/memoryConstants';
import MemoryRowDetail from './MemoryRowDetail';
import MemoryRowActions from './MemoryRowActions';
import MemoryProvenance from './MemoryProvenance';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { silentCatch } from '@/lib/silentCatch';


interface Revision { title: string; content: string; category: string; importance: number; edited_at: string; }

/**
 * `memory.tags` is a free-form column, so a parsed revision is an unknown until
 * checked. Rows that fail the shape are dropped rather than rendered as blanks
 * and an "Invalid Date".
 */
function isRevision(value: unknown): value is Revision {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.title === 'string' && typeof r.content === 'string' && typeof r.category === 'string';
}

function parseRevisions(tags: string | null): { source: string; revisions: Revision[] } {
  if (!tags) return { source: '', revisions: [] };
  try {
    const parsed = JSON.parse(tags);
    if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.revisions)) {
      // `tags` is a DB-authored blob: every field is whatever some writer put
      // there, so `source` is narrowed rather than asserted. A non-string here
      // reaches `.includes()` on the render path.
      return {
        source: typeof parsed.source === 'string' ? parsed.source : '',
        revisions: parsed.revisions.filter(isRevision),
      };
    }
  } catch (err) { silentCatch("features/teams/sub_teamMemory/components/panel/TeamMemoryRow:catch1")(err); }
  return { source: tags, revisions: [] };
}

interface TeamMemoryRowProps {
  memory: TeamMemory;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => void;
}

export default function TeamMemoryRow({ memory, onDelete, onImportanceChange, onEdit }: TeamMemoryRowProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dots = importanceToDots(memory.importance);
  // `source` is the provenance field parseRevisions already recovers. Reading
  // `memory.tags` directly instead matched the whole tags blob — which becomes
  // `{"source":…,"revisions":[…]}` the first time a memory is edited, so any
  // revision whose title/content contained the substring "auto" re-labelled a
  // hand-written memory as pipeline-authored.
  const { source, revisions } = useMemo(() => parseRevisions(memory.tags), [memory.tags]);
  const isAuto = source.includes('auto');

  const startEdit = useCallback(() => { if (onEdit) setEditing(true); }, [onEdit]);

  if (editing && onEdit) {
    return (
      <MemoryRowDetail
        id={memory.id}
        initialTitle={memory.title}
        initialContent={memory.content}
        initialCategory={memory.category}
        initialImportance={memory.importance}
        onSave={(id, t, c, cat, imp) => { onEdit(id, t, c, cat, imp); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className="group relative px-2.5 py-2 rounded-modal border border-primary/5 hover:border-primary/15 transition-colors"
      onDoubleClick={onEdit ? startEdit : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="typo-body font-medium text-foreground/90 truncate">{memory.title}</p>
          <p className="typo-body text-foreground line-clamp-2 mt-0.5">{memory.content}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <CategoryChip
              category={memory.category}
              source="team"
              label={tokenLabel(t, 'memory_category', memory.category)}
            />
            <span className="typo-body px-1.5 py-0.5 rounded-full bg-primary/5 text-foreground">
              {isAuto ? pt.auto_label : pt.manual_label}
            </span>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: IMPORTANCE_DOTS }).map((_, i) => (
                <button
                  type="button"
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i < dots ? 'bg-amber-400' : 'bg-primary/10'} hover:bg-amber-300`}
                  // Re-clicking the rung a memory already sits on writes nothing:
                  // the dot row is coarser than the 1-10 field behind it, so an
                  // unguarded click could round-trip the value into a different
                  // number with no visible change to the dots.
                  onClick={() => {
                    const next = dotsToImportance(i);
                    if (next !== memory.importance) onImportanceChange(memory.id, next);
                  }}
                  aria-label={`${pt.importance_label} ${dotsToImportance(i)}`}
                />
              ))}
            </div>
            {revisions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-0.5 typo-body text-foreground hover:text-violet-400 transition-colors"
                aria-label={pt.version_history}
                aria-expanded={showHistory}
              >
                <History className="w-3 h-3" /><span>{revisions.length}</span>
              </button>
            )}
          </div>

          {/* The row carried member_id / persona_id / run_id all along and
              showed none of them, so a belief a team acts on arrived with no
              author. */}
          <MemoryProvenance memberId={memory.member_id} personaId={memory.persona_id} runId={memory.run_id} />

          {showHistory && revisions.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-primary/10 pt-2">
              <div className="flex items-center justify-between">
                <span className="typo-body font-medium text-foreground">{pt.version_history}</span>
                <button type="button" onClick={() => setShowHistory(false)} aria-label={t.common.close} className="p-0.5 text-foreground hover:text-foreground/70">
                  <ChevronUp className="w-3 h-3" />
                </button>
              </div>
              {[...revisions].reverse().map((rev, i) => (
                <div key={i} className="pl-2 border-l-2 border-primary/10 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="typo-body font-medium text-foreground truncate">{rev.title}</span>
                    <span className="typo-body text-foreground">{tokenLabel(t, 'memory_category', rev.category)}</span>
                  </div>
                  <p className="typo-body text-foreground line-clamp-1">{rev.content}</p>
                  {/* Was a raw `new Date(...).toLocaleDateString(undefined, …)`:
                      it formatted against whatever locale the host OS happens
                      to be in, and it parsed `edited_at` without
                      `normalizeTimestamp`, so a SQLite-authored
                      "YYYY-MM-DD HH:MM:SS" (UTC, no designator) read as local
                      time and every revision displayed offset by the viewer's
                      UTC offset. AbsoluteTime is the repo's one door for a
                      fixed timestamp and handles both. */}
                  <AbsoluteTime timestamp={rev.edited_at} variant="compact" className="typo-body text-foreground" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Always mounted, revealed by hover OR keyboard focus — the previous
          `hovered && …` gate meant edit/delete existed only for a pointer, so
          keyboard and screen-reader users had no route to either verb. */}
      <div className="opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
        <MemoryRowActions canEdit={!!onEdit} onEdit={startEdit} onDelete={() => setConfirmingDelete(true)} />
      </div>

      {/* Deleting a team memory is irreversible and the trash icon sat one
          click away from it with no confirmation at all. */}
      {confirmingDelete && (
        <ConfirmDialog
          danger
          title={pt.delete_memory}
          body={t.common.confirm_destructive_cannot_undo}
          confirmLabel={t.common.delete}
          onConfirm={() => { setConfirmingDelete(false); onDelete(memory.id); }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
