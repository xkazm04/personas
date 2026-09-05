import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NotepadText, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';
import { listProjects } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import { NoteTabStrip } from './NoteTabStrip';
import { NoteArchiveModal } from './NoteArchiveModal';
import { NoteDispatchBar } from './parts/NoteDispatchBar';
import { noteActionsFor } from './notepadActions';
import { useNoteSuggestions } from './athena/noteSuggestions';
import {
  archivedNotes as archivedNotesOf,
  atCap as atCapNow,
  createNote,
  deleteNote,
  flush,
  forkNote,
  load,
  archiveNote,
  patchNote,
  renameNote,
  restoreNote,
  setProject,
} from './notepadStore';
import { useNotepadSaveStates, useNotepadStatus, useOpenNotes, useArchivedNotes } from './useNotepad';
import NoteBodyJournal from './variants/NoteBodyJournal';
import NoteBodyWorkbench from './variants/NoteBodyWorkbench';
import NoteBodySplitCanvas from './variants/NoteBodySplitCanvas';
import type { NoteBodyProps } from './variants/types';

// ---------------------------------------------------------------------------
// THROWAWAY variant switcher (prototype discipline)
//
// Three directional layouts behind a strip of buttons. It exists to be USED —
// switch between them on real notes, pick one, then delete the other two files
// AND this block. Do not build on it: no persistence, no store key, no i18n
// beyond the three names, and it is the only thing in the feature that knows
// more than one variant exists.
// ---------------------------------------------------------------------------
type VariantId = 'journal' | 'workbench' | 'split';
const VARIANTS: { id: VariantId; Body: (p: NoteBodyProps) => React.JSX.Element }[] = [
  { id: 'journal', Body: NoteBodyJournal },
  { id: 'workbench', Body: NoteBodyWorkbench },
  { id: 'split', Body: NoteBodySplitCanvas },
];

/** Ghost tab strip — shown UNDER the permanent chrome while the first fetch is
 *  in flight and there is nothing to draw. Never a spinner: this is a surface
 *  loading its data (docs/design/overview-loading.md). */
function TabStripGhost() {
  return (
    <div className="flex items-center gap-1 px-3 h-11 border-b border-primary/10" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 w-32 rounded-interactive bg-secondary/25" />
      ))}
    </div>
  );
}

interface PendingDelete {
  note: DevNote;
  permanent: boolean;
}

/**
 * The notepad overlay.
 *
 * Full-screen layer above the footer, portaled to `<body>` so it shares a
 * stacking context with the footer (the same lesson `DesktopFooter` records:
 * a `z-index` inside a transformed subtree means nothing). Tab strip on top,
 * the chosen body variant in the middle, the dispatch bar at the bottom.
 */
export default function NotepadOverlayHost() {
  const { t, tx } = useTranslation();
  const setOpen = useSystemStore((s) => s.notepadSetOpen);
  const activeId = useSystemStore((s) => s.notepadActiveNoteId);
  const setActiveNote = useSystemStore((s) => s.notepadSetActiveNote);

  const notes = useOpenNotes();
  const archived = useArchivedNotes();
  const saveStates = useNotepadSaveStates();
  const { loading, loaded } = useNotepadStatus();

  const [variant, setVariant] = useState<VariantId>('workbench');
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // First open fetches; later opens paint the notes already in memory and
  // refresh underneath them — a re-open must never re-ghost (loading law 1).
  useEffect(() => {
    void load();
    listProjects()
      .then(setProjects)
      .catch(silentCatch('notepad projects'));
  }, []);

  const close = useCallback(() => {
    // Never close over a stranded debounce — the overlay unmounting is exactly
    // the moment the last keystrokes would have been lost.
    void flush().finally(() => setOpen(false));
  }, [setOpen]);

  // Escape closes; Tab cycles inside the layer. Registered at a priority BELOW
  // BaseModal's 80 so a confirm dialog opened from here takes Escape first.
  useAppKeyboard(
    (event) => {
      if (event.key === 'Escape') {
        close();
        return true;
      }
      if (event.key !== 'Tab' || !rootRef.current) return false;
      const focusable = rootRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return false;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return true;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
        return true;
      }
      return false;
    },
    { enabled: true, priority: NOTEPAD_LAYER_PRIORITY },
  );

  // Keep the selection valid: a persisted id can name a note that was deleted
  // in another session, and a fresh install has no selection at all.
  const active = useMemo(
    () => notes.find((n) => n.id === activeId) ?? notes[0] ?? null,
    [notes, activeId],
  );
  useEffect(() => {
    if (active && active.id !== activeId) setActiveNote(active.id);
    if (!active && activeId) setActiveNote(null);
  }, [active, activeId, setActiveNote]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === active?.projectId) ?? null,
    [projects, active],
  );

  // Athena's open suggestions for the note on screen. Read from the companion
  // store rather than fetched here: `AthenaChatPanel` is mounted app-wide, so
  // its chat-card listener and durable-row hydration already keep this array
  // live and refresh-proof whether or not her panel is open.
  const suggestions = useNoteSuggestions(active?.id ?? null);

  const selectNote = useCallback(
    (id: string) => {
      // Flush the outgoing note before switching — the debounce timer belongs
      // to a note, not to the surface, and leaving one armed across a switch is
      // how an edit lands on the wrong row in the user's mental model.
      void flush(activeId ?? undefined);
      setActiveNote(id);
    },
    [activeId, setActiveNote],
  );

  const handleCreate = useCallback(async () => {
    const created = await createNote(t.notepad.new_note_title);
    if (created) setActiveNote(created.id);
  }, [setActiveNote, t.notepad.new_note_title]);

  const handleDelete = useCallback((note: DevNote, permanent: boolean) => {
    setPendingDelete({ note, permanent });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    await deleteNote(pendingDelete.note.id);
    setPendingDelete(null);
  }, [pendingDelete]);

  const Body = VARIANTS.find((v) => v.id === variant)?.Body ?? NoteBodyWorkbench;
  const atCap = atCapNow();
  const showGhost = loading && notes.length === 0;
  const showEmpty = loaded && !loading && notes.length === 0;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.notepad.overlay_label}
      data-testid="notepad-overlay"
      className="fixed inset-0 bottom-8 z-[200] flex flex-col bg-background animate-fade-slide-in"
    >
      <div className="flex items-center justify-between gap-3 px-4 h-10 border-b border-primary/10">
        <span className="flex items-center gap-2 typo-caption text-foreground/60">
          <NotepadText className="w-4 h-4" aria-hidden />
          {t.notepad.title}
        </span>

        {/* THROWAWAY — see the block comment at the top of this file. */}
        <div className="flex items-center gap-1" aria-label={t.notepad.variant_label}>
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-pressed={variant === v.id}
              data-testid={`notepad-variant-${v.id}`}
              className={`h-7 px-2.5 rounded-input typo-caption transition-colors focus-ring ${
                variant === v.id
                  ? 'bg-primary/10 text-foreground ring-1 ring-primary/25'
                  : 'text-foreground/55 hover:text-foreground hover:bg-secondary/40'
              }`}
            >
              {v.id === 'journal'
                ? t.notepad.variant_journal
                : v.id === 'workbench'
                  ? t.notepad.variant_workbench
                  : t.notepad.variant_split}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={close}
          aria-label={t.notepad.close}
          data-testid="notepad-close"
          className="w-7 h-7 rounded-input flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-secondary/50 transition-colors focus-ring"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {showGhost ? (
        <TabStripGhost />
      ) : (
        <NoteTabStrip
          notes={notes}
          activeId={active?.id ?? null}
          saveStates={saveStates}
          atCap={atCap}
          onSelect={selectNote}
          onRename={renameNote}
          onCreate={() => void handleCreate()}
          onFork={(id) => void forkNote(id)}
          onArchive={(id) => void archiveNote(id)}
          onDelete={(id) => {
            const note = notes.find((n) => n.id === id);
            if (note) handleDelete(note, false);
          }}
          onOpenArchive={() => setArchiveOpen(true)}
          panel={
            active ? (
              <Body
                note={active}
                onPatch={(patch) => patchNote(active.id, patch)}
                readOnly={active.status !== 'draft'}
                project={activeProject}
                suggestions={suggestions}
                actions={noteActionsFor(active, activeProject)}
              />
            ) : undefined
          }
        />
      )}

      {showEmpty ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={NotepadText}
            title={t.notepad.empty_title}
            subtitle={t.notepad.empty_subtitle}
            action={{ label: t.notepad.empty_action, onClick: () => void handleCreate() }}
          />
        </div>
      ) : active ? (
        <>
          <NoteDispatchBar
            note={active}
            project={activeProject}
            onSelectProject={(project) => setProject(active.id, project.id)}
            actions={noteActionsFor(active, activeProject)}
          />
        </>
      ) : (
        <div className="flex-1" />
      )}

      {archiveOpen && (
        <NoteArchiveModal
          notes={archived.length > 0 ? archived : archivedNotesOf()}
          atCap={atCap}
          onRestore={async (id) => {
            await restoreNote(id);
          }}
          onDelete={(note) => handleDelete(note, true)}
          onClose={() => setArchiveOpen(false)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          danger
          title={
            pendingDelete.permanent
              ? t.notepad.delete_permanently_confirm_title
              : t.notepad.delete_confirm_title
          }
          body={tx(
            pendingDelete.permanent
              ? t.notepad.delete_permanently_confirm_body
              : t.notepad.delete_confirm_body,
            { title: pendingDelete.note.title },
          )}
          confirmLabel={
            pendingDelete.permanent ? t.notepad.delete_permanently : t.notepad.delete
          }
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>,
    document.body,
  );
}
