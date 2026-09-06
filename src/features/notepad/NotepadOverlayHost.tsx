import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { NotepadText, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';
import { listProjects } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { lazyRetry } from '@/lib/lazyRetry';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import { NoteTabStrip } from './NoteTabStrip';
// Both of these are MODALS — nothing renders them until a menu item is
// picked, so nothing should have to load them to open the pad. `BaseModal`
// and the confirm dialog stay out of the pad's first paint entirely.
const NoteArchiveModal = lazyRetry(() =>
  import('./NoteArchiveModal').then((m) => ({ default: m.NoteArchiveModal })),
);
const ConfirmDialog = lazyRetry(() =>
  import('@/features/shared/components/feedback/ConfirmDialog').then((m) => ({
    default: m.ConfirmDialog,
  })),
);
import { NoteDispatchBar } from './parts/NoteDispatchBar';
import { noteActionsFor } from './notepadActions';
import { useNoteSuggestions } from './athena/noteSuggestions';
import { markNotepadPhase } from './notepadTiming';
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
import NoteBody from './NoteBody';

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
 * the body in the middle, the dispatch bar at the bottom.
 *
 * The body is the WORKBENCH layout, chosen 2026-09-06 out of the three the
 * prototype round put behind a switcher (Journal, Workbench, Split canvas).
 * The other two and the switcher were deleted in the same commit that picked
 * it — a surviving switcher is a decision nobody made.
 */
export default function NotepadOverlayHost() {
  const { t, tx } = useTranslation();
  const reduceMotion = useReducedMotion();
  const setOpen = useSystemStore((s) => s.notepadSetOpen);
  const activeId = useSystemStore((s) => s.notepadActiveNoteId);
  const setActiveNote = useSystemStore((s) => s.notepadSetActiveNote);

  const notes = useOpenNotes();
  const archived = useArchivedNotes();
  const saveStates = useNotepadSaveStates();
  const { loading, loaded } = useNotepadStatus();

  const [projects, setProjects] = useState<DevProject[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // First open fetches; later opens paint the notes already in memory and
  // refresh underneath them — a re-open must never re-ghost (loading law 1).
  useEffect(() => {
    markNotepadPhase('mount');
    // One frame after mount is the first moment the operator could have SEEN
    // the real pad; everything before it is work they were waiting through.
    const raf = requestAnimationFrame(() => markNotepadPhase('paint'));
    void load().finally(() => markNotepadPhase('notes'));
    listProjects()
      .then(setProjects)
      .catch(silentCatch('notepad projects'))
      .finally(() => markNotepadPhase('projects'));
    return () => cancelAnimationFrame(raf);
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

  const atCap = atCapNow();
  const showGhost = loading && notes.length === 0;
  const showEmpty = loaded && !loading && notes.length === 0;

  return createPortal(
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.notepad.overlay_label}
      data-testid="notepad-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.14, ease: 'easeOut' }}
      // TOP OFFSET, not `inset-0`: the title bar is the app's own chrome and
      // stays reachable while the pad is up (the window controls live there).
      // `--titlebar-height` is the shell's owned measure of it — the same one
      // PersonaMonitor and the notification drawer anchor to, so all three
      // agree instead of each carrying its own guess.
      className="fixed inset-x-0 bottom-8 top-[var(--titlebar-height,40px)] z-[200] flex flex-col bg-background"
    >
      <div className="flex items-center justify-between gap-3 px-4 h-10 border-b border-primary/10">
        <span className="flex items-center gap-2 typo-caption text-foreground/60">
          <NotepadText className="w-4 h-4" aria-hidden />
          {t.notepad.title}
        </span>

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
              // Keyed on the note, so switching notes crosses a fade rather
              // than snapping. Never keyed on the note's TEXT — that would
              // re-mount the editor on every keystroke.
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12, ease: 'easeOut' }}
                  className="flex-1 min-h-0 flex flex-col"
                >
                  <NoteBody
                    note={active}
                    onPatch={(patch) => patchNote(active.id, patch)}
                    readOnly={active.status !== 'draft'}
                    project={activeProject}
                    suggestions={suggestions}
                    actions={noteActionsFor(active, activeProject)}
                  />
                </motion.div>
              </AnimatePresence>
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
            suggestionCount={suggestions.length}
          />
        </>
      ) : (
        <div className="flex-1" />
      )}

      {archiveOpen && (
        <Suspense fallback={null}>
        <NoteArchiveModal
          notes={archived.length > 0 ? archived : archivedNotesOf()}
          atCap={atCap}
          onRestore={async (id) => {
            await restoreNote(id);
          }}
          onDelete={(note) => handleDelete(note, true)}
          onClose={() => setArchiveOpen(false)}
        />
        </Suspense>
      )}

      {pendingDelete && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </motion.div>,
    document.body,
  );
}
