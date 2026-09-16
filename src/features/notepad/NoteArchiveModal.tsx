import { useId } from 'react';
import { Copy, Trash2, Undo2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import { formatSpanCompact } from '@/lib/utils/formatters';

interface NoteArchiveModalProps {
  notes: DevNote[];
  /** Notes in status `shipped` — off the desk and out of the cap, so this
   *  drawer is the only place they can be read. */
  shipped: DevNote[];
  /** The plan join, for the ship stamp and the cut→ship span. A shipped note
   *  whose summary is missing renders its row WITHOUT those two readings rather
   *  than with invented ones. */
  summaries: Readonly<Record<string, NotePlanSummary>>;
  atCap: boolean;
  onRestore: (id: string) => Promise<void>;
  onFork: (id: string) => Promise<void>;
  onDelete: (note: DevNote) => void;
  onClose: () => void;
}

/**
 * The archive drawer — TWO groups, and they are not the same act.
 *
 * **Archived** is work put aside: it can come back. Restore is gated on the
 * SAME cap the `+` button obeys — restoring is creating, from the server's point
 * of view, and a control that fails only after you press it is the thing the cap
 * tooltip exists to prevent. Permanent deletion is routed through the host's
 * `ConfirmDialog` (via `onDelete`) rather than being confirmed inline: two
 * stacked modals owned by two components is how a dialog ends up under its own
 * backdrop.
 *
 * **Shipped** is work that LANDED. A shipped note is the record of a milestone
 * that shipped, so it offers neither Restore nor Delete — un-shipping a
 * milestone from a notes drawer would rewrite a record, and the milestone's own
 * status is the authority for that transition anyway (`NotePlanContext` states
 * why the pad never writes a certification). Fork is the verb that fits: it
 * copies the brief into a fresh draft and leaves the record alone.
 */
export function NoteArchiveModal({
  notes,
  shipped,
  summaries,
  atCap,
  onRestore,
  onFork,
  onDelete,
  onClose,
}: NoteArchiveModalProps) {
  const { t, tx } = useTranslation();
  const titleId = useId();

  return (
    <BaseModal isOpen onClose={onClose} titleId={titleId} size="md" portal>
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="typo-heading text-foreground">
          {t.notepad.archived_title}
        </h2>

        {notes.length === 0 && shipped.length === 0 ? (
          <EmptyState icon={Undo2} title={t.notepad.archived_empty} />
        ) : (
          <div className="flex flex-col gap-4 max-h-96 overflow-y-auto">
            {notes.length > 0 && (
              <section className="flex flex-col gap-1">
                {shipped.length > 0 && (
                  // muted-ok: group band — chrome saying WHICH list, not content to read.
                  <h3 className="typo-label text-foreground/70 px-3">{t.notepad.status_archived}</h3>
                )}
                <ul className="flex flex-col gap-1">
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
              </section>
            )}

            {shipped.length > 0 && (
              <section className="flex flex-col gap-1" data-testid="notepad-shipped-group">
                {/* muted-ok: group band — chrome saying WHICH list, not content to read. */}
                <h3 className="typo-label text-foreground/70 px-3">{t.notepad.archived_shipped_title}</h3>
                <ul className="flex flex-col gap-1">
                  {shipped.map((note) => {
                    const summary = summaries[note.id];
                    const cycle = summary
                      ? formatSpanCompact(summary.cutAt, summary.shippedAt, '')
                      : '';
                    return (
                      <li
                        key={note.id}
                        data-testid={`notepad-shipped-${note.id}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-card hover:bg-secondary/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0 flex flex-col">
                          <span className="typo-body text-foreground/90 truncate">{note.title}</span>
                          <span className="flex items-center gap-1.5 typo-caption text-foreground/85">
                            {summary?.shippedAt && <RelativeTime timestamp={summary.shippedAt} />}
                            {cycle && (
                              <>
                                {summary?.shippedAt && <span aria-hidden>·</span>}
                                <span className="tabular-nums" data-testid={`notepad-shipped-cycle-${note.id}`}>
                                  {tx(t.notepad.archived_cycle_time, { span: cycle })}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                        <AsyncButton
                          variant="secondary"
                          size="xs"
                          disabled={atCap}
                          icon={<Copy className="w-3 h-3" />}
                          onClick={() => onFork(note.id)}
                        >
                          {t.notepad.fork}
                        </AsyncButton>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
