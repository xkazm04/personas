import { FilePlus2, HelpCircle, NotepadText, Pencil } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { resolveNoteSuggestion } from '@/api/notepad';
import {
  markRowResolvedLocally,
  parseNoteSuggestionRows,
} from '@/features/notepad/athena/noteSuggestions';
import { useTranslation } from '@/i18n/useTranslation';
import { refetchNote } from '@/features/notepad/notepadStore';
import type { NoteSuggestion } from '@/features/notepad/variants/types';
import { toastCatch } from '@/lib/silentCatch';

const KIND_ICON: Record<NoteSuggestion['kind'], typeof FilePlus2> = {
  section: FilePlus2,
  edit: Pencil,
  question: HelpCircle,
};

/**
 * Athena's note suggestions, seen from the CHAT.
 *
 * The pad is where these rows are meant to be answered — each one renders as an
 * inline block at the heading it anchors to, which is the reading position that
 * makes an edit judgeable. This card is the second view of the same rows, for
 * the case where the operator is in the conversation and not in the note.
 *
 * It carries no batch Confirm for the same reason the pad does not: every row
 * is answered on its own. What it deliberately lacks is the pad's **Edit**
 * affordance — rewriting a paragraph belongs next to the document it goes into,
 * and a textarea in a 380px chat column is not that place. Accept, Reject, or
 * open the pad.
 */
export function AthenaNoteSuggestionsCard({
  config,
  title,
  cardId,
}: {
  config?: Record<string, unknown>;
  title?: string;
  /** Durable `companion_chat_card` row id — what the resolve command takes. */
  cardId?: string;
}) {
  const { t, tx } = useTranslation();
  const noteId = typeof config?.note_id === 'string' ? config.note_id : '';
  const noteTitle = typeof config?.note_title === 'string' ? config.note_title : '';
  const rows = parseNoteSuggestionRows(cardId ?? '', config?.rows);
  const open = rows.filter((r) => r.outcome === null);

  const resolve = async (row: NoteSuggestion, outcome: 'accepted' | 'rejected') => {
    if (!cardId) return;
    try {
      await resolveNoteSuggestion(cardId, row.rowId, outcome);
      markRowResolvedLocally(cardId, row.rowId, outcome);
      if (noteId) void refetchNote(noteId);
    } catch (e) {
      toastCatch('notepad resolve suggestion')(e);
    }
  };

  return (
    <div
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
      data-testid="athena-note-suggestions-card"
    >
      <header className="flex items-baseline gap-2">
        <NotepadText className="w-3.5 h-3.5 text-primary shrink-0 translate-y-0.5" />
        <div className="min-w-0 flex-1">
          <p className="typo-body-strong text-foreground break-words">
            {title || t.plugins.companion.note_suggestions_heading}
          </p>
          <p className="typo-caption text-foreground">
            {tx(
              rows.length === 1
                ? t.plugins.companion.note_suggestions_count_one
                : t.plugins.companion.note_suggestions_count_other,
              { count: rows.length, title: noteTitle },
            )}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="typo-caption text-foreground">{t.plugins.companion.note_suggestions_empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const Icon = KIND_ICON[row.kind];
            const settled = row.outcome !== null;
            return (
              <li
                key={row.rowId}
                className="rounded-card border border-border bg-secondary/30 p-3 space-y-2"
                data-testid={`athena-note-suggestion-${row.rowId}`}
              >
                <div className="flex items-center gap-2 typo-caption text-foreground">
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {row.title && <span className="truncate">{row.title}</span>}
                  {settled && (
                    <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-interactive bg-secondary/60 typo-caption text-foreground">
                      {row.outcome === 'rejected'
                        ? t.plugins.companion.note_suggestions_rejected
                        : t.plugins.companion.note_suggestions_accepted}
                    </span>
                  )}
                </div>
                <MarkdownRenderer content={row.bodyMd} className="typo-caption text-foreground" />
                {row.kind === 'question' ? (
                  <p className="typo-caption text-foreground">
                    {t.plugins.companion.note_suggestions_question_hint}
                  </p>
                ) : null}
                {!settled && (
                  <div className="flex items-center gap-2">
                    <AsyncButton
                      size="sm"
                      variant="primary"
                      disabled={!cardId}
                      onClick={() => resolve(row, 'accepted')}
                      data-testid={`athena-note-suggestion-accept-${row.rowId}`}
                    >
                      {t.plugins.companion.note_suggestions_accept}
                    </AsyncButton>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!cardId}
                      onClick={() => void resolve(row, 'rejected')}
                      data-testid={`athena-note-suggestion-reject-${row.rowId}`}
                    >
                      {t.plugins.companion.note_suggestions_reject}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open.length > 0 && (
        <p className="typo-caption text-foreground">{t.plugins.companion.note_suggestions_open_pad}</p>
      )}
    </div>
  );
}
