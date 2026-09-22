// Reading Athena's `note_suggestions` cards from the pad's side.
//
// The card is a `companion_chat_card` row and its rows arrive as snake_case
// JSON inside `config_json` — the same wire shape `ship_goals` uses, hand-built
// in `note_suggestions.rs` and parsed here. There is deliberately NO ts-rs
// binding for it: a generated camelCase type would describe a payload that does
// not exist on the wire, and the boundary parse below is where the shape is
// actually checked.
//
// Where the cards come from: `AthenaChatPanel` is mounted app-wide (App.tsx's
// `OverlayIsland`), so its engine's chat-card listener and its durable-row
// hydration both run whether or not the panel is open. That makes
// `useCompanionStore().chatCards` a live, refresh-surviving source the pad can
// read without owning a second fetch — and without the pad ever writing into
// the companion store.
import { useMemo } from 'react';

import { useCompanionStore } from '@/features/companions/athena/companionStore';

import type { NoteSuggestion } from '../types';

/** The card kind the dispatcher emits for `show_note_suggestions`. */
export const NOTE_SUGGESTIONS_KIND = 'note_suggestions';

/** One `note_suggestions` card, flattened for the pad. */
export interface NoteSuggestionCard {
  /** Durable `companion_chat_card` row id — what `resolveNoteSuggestion` takes. */
  cardId: string;
  noteId: string;
  noteTitle: string;
  rows: NoteSuggestion[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseKind(raw: unknown): NoteSuggestion['kind'] | null {
  return raw === 'section' || raw === 'edit' || raw === 'question' ? raw : null;
}

function parseOutcome(raw: unknown): NoteSuggestion['outcome'] {
  return raw === 'accepted' || raw === 'rejected' || raw === 'edited' ? raw : null;
}

/**
 * Parse the `rows` array out of a card config.
 *
 * INVARIANT for the narrowing: this blob round-tripped through SQLite as text
 * and was written by a Rust validator that is free to change under a running
 * frontend, so its real type is `unknown`. Every field is checked; a row that
 * fails any check is DROPPED rather than defaulted, because a suggestion block
 * with an invented body is worse than a suggestion block that is missing.
 */
export function parseNoteSuggestionRows(cardId: string, raw: unknown): NoteSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteSuggestion[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const kind = parseKind(row.kind);
    const rowId = typeof row.row_id === 'string' ? row.row_id : '';
    const bodyMd = typeof row.body_md === 'string' ? row.body_md : '';
    if (!kind || !rowId || !bodyMd) continue;
    const anchorRecord = asRecord(row.anchor);
    const afterHeading =
      anchorRecord && typeof anchorRecord.after_heading === 'string'
        ? anchorRecord.after_heading
        : null;
    out.push({
      cardId,
      rowId,
      kind,
      anchor: afterHeading ? { after_heading: afterHeading } : null,
      ...(typeof row.title === 'string' && row.title ? { title: row.title } : {}),
      bodyMd,
      outcome: parseOutcome(row.outcome),
    });
  }
  return out;
}

/**
 * Every `note_suggestions` card currently in the transcript, flattened.
 *
 * Exported separately from the hook so a test can drive it with a plain array
 * instead of a store.
 */
export function noteSuggestionCards(
  cards: readonly { id?: string; kind: string; config?: Record<string, unknown> }[],
): NoteSuggestionCard[] {
  const out: NoteSuggestionCard[] = [];
  for (const card of cards) {
    if (card.kind !== NOTE_SUGGESTIONS_KIND || !card.id) continue;
    const noteId = typeof card.config?.note_id === 'string' ? card.config.note_id : '';
    if (!noteId) continue;
    out.push({
      cardId: card.id,
      noteId,
      noteTitle: typeof card.config?.note_title === 'string' ? card.config.note_title : '',
      rows: parseNoteSuggestionRows(card.id, card.config?.rows),
    });
  }
  return out;
}

/** Undecided rows across every card for one note, in card order. */
export function pendingSuggestionsFor(
  cards: NoteSuggestionCard[],
  noteId: string | null | undefined,
): NoteSuggestion[] {
  if (!noteId) return [];
  return cards
    .filter((c) => c.noteId === noteId)
    .flatMap((c) => c.rows.filter((r) => r.outcome === null));
}

/**
 * The pad's live view of Athena's open suggestions for one note.
 *
 * Subscribes to the companion store's card array. A resolved row disappears
 * from this list on the next store write, which is what makes Accept feel
 * immediate without the pad keeping a second copy of the card's state.
 */
export function useNoteSuggestions(noteId: string | null | undefined): NoteSuggestion[] {
  const cards = useCompanionStore((s) => s.chatCards);
  return useMemo(() => pendingSuggestionsFor(noteSuggestionCards(cards), noteId), [cards, noteId]);
}

/**
 * Mark one row resolved in the LOCAL copy of the card.
 *
 * The server has already written the real outcome; this is what makes the block
 * leave the note without a round trip through the companion panel. It is a
 * projection of a write that succeeded, never a prediction of one — call it
 * only after `resolveNoteSuggestion` resolves.
 */
export function markRowResolvedLocally(
  cardId: string,
  rowId: string,
  outcome: Exclude<NoteSuggestion['outcome'], null>,
): void {
  const store = useCompanionStore.getState();
  const card = store.chatCards.find((c) => c.id === cardId);
  const rows = card?.config?.rows;
  if (!Array.isArray(rows)) return;
  store.patchChatCardConfig(cardId, {
    rows: rows.map((row) => {
      const record = asRecord(row);
      return record && record.row_id === rowId ? { ...record, outcome } : row;
    }),
  });
}

/** The open-suggestion count for one note, read from the live companion store
 *  — what `askAthena` records as the baseline of a wait. */
export function openSuggestionCountFor(noteId: string): number {
  return pendingSuggestionsFor(noteSuggestionCards(useCompanionStore.getState().chatCards), noteId).length;
}

/**
 * Re-count open suggestions for every note Athena is being waited on, whenever
 * the companion's cards change — so a wait started from the desk (the card
 * menu, a thread comment) ends when her blocks land even with the editor, and
 * the dispatch bar that used to watch the number, unmounted. Idempotent.
 *
 * The ask state is imported lazily through the argument pair rather than
 * statically, so this module keeps no dependency on the thread store.
 */
let stopAskWatch: (() => void) | null = null;
export function startNoteAskSuggestionWatch(
  askingNoteIds: () => string[],
  report: (noteId: string, count: number) => void,
): void {
  if (stopAskWatch) return;
  stopAskWatch = useCompanionStore.subscribe((state, prev) => {
    if (state.chatCards === prev.chatCards) return;
    const ids = askingNoteIds();
    if (ids.length === 0) return;
    const cards = noteSuggestionCards(state.chatCards);
    for (const id of ids) report(id, pendingSuggestionsFor(cards, id).length);
  });
}
