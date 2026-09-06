import { useId } from 'react';
import { Trash2, Undo2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevNote } from '@/lib/bindings/DevNote';

interface NoteArchiveModalProps {
  notes: DevNote[];
  atCap: boolean;
  onRestore: (id: string) => Promise<void>;
  onDelete: (note: DevNote) => void;
  onClose: () => void;
}

/**
 * The archive drawer.
 *
 * Restore is gated on the SAME cap the `+` button obeys — restoring is
 * creating, from the server's point of view, and a control that fails only
 * after you press it is the thing the cap tooltip exists to prevent. Permanent
 * deletion is routed through the host's `ConfirmDialog` (via `onDelete`)
 * rather than being confirmed inline: two stacked modals owned by two
 * components is how a dialog ends up under its own backdrop.
 */
export function NoteArchiveModal({ notes, atCap, onRestore, onDelete, onClose }: NoteArchiveModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <BaseModal isOpen onClose={onClose} titleId={titleId} size="md" portal>
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="typo-heading text-foreground">
          {t.notepad.archived_title}
        </h2>

        {notes.length === 0 ? (
          <EmptyState icon={Undo2} title={t.notepad.archived_empty} />
        ) : (
          <ul className="flex flex-col gap-1 max-h-96 overflow-y-auto">
            {notes.map((note) => (
              <li
                key={note.id}
                data-testid={`notepad-archived-${note.id}`}
                className="flex items-center gap-3 px-3 py-2 rounded-card hover:bg-secondary/30 transition-colors"
              >
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="typo-body text-foreground/90 truncate">{note.title}</span>
                  <RelativeTime timestamp={note.archivedAt} className="typo-caption text-foreground/60" />
                </div>
                <AsyncButton
                  variant="secondary"
                  size="xs"
                  disabled={atCap}
                  icon={<Undo2 className="w-3 h-3" />}
                  onClick={() => onRestore(note.id)}
                >
                  {t.notepad.restore}
                </AsyncButton>
                <button
                  type="button"
                  onClick={() => onDelete(note)}
                  aria-label={t.notepad.delete_permanently}
                  className="w-7 h-7 rounded-input flex items-center justify-center text-status-error/70 hover:text-status-error hover:bg-status-error/10 transition-colors focus-ring"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BaseModal>
  );
}
