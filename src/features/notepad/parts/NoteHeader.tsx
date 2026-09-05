import { Lock } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Badge } from '@/features/shared/components/display/Badge';
import { InlineEditableText } from '@/features/shared/components/display/InlineEditableText';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevNote } from '@/lib/bindings/DevNote';

import { noteStatusMeta } from '../noteStatusMeta';

interface NoteHeaderProps {
  note: DevNote;
  onRename: (title: string) => void;
  /** Body is locked (non-draft). The TITLE stays editable — the contract keeps
   *  renaming legal in every non-archived status, and a title is metadata. */
  readOnly: boolean;
  className?: string;
}

/**
 * Title + status + last-touched, shared by every body variant.
 *
 * Hoisted the moment the second variant needed it, per the prototype rule: a
 * piece two directions agree on is not a directional choice any more.
 */
export function NoteHeader({ note, onRename, readOnly, className }: NoteHeaderProps) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const StatusIcon = meta.Icon;

  return (
    <header className={`flex items-start justify-between gap-4 ${className ?? ''}`}>
      <div className="min-w-0 flex flex-col gap-1">
        <InlineEditableText
          value={note.title}
          onCommit={onRename}
          disabled={note.status === 'archived'}
          maxLength={120}
          className="typo-title text-foreground"
          renameLabel={t.notepad.rename}
        />
        <span className="typo-caption text-foreground/60 flex items-center gap-1.5">
          <RelativeTime timestamp={note.updatedAt} />
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {readOnly && (
          <span className="flex items-center gap-1 typo-caption text-foreground/50">
            <Lock className="w-3 h-3" aria-hidden />
          </span>
        )}
        <Badge variant={meta.badgeVariant} size="sm">
          <StatusIcon className="w-3 h-3" aria-hidden />
          {meta.labelKey(t)}
        </Badge>
      </div>
    </header>
  );
}
