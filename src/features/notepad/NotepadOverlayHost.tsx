import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronRight, NotepadText, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
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
import { loadThreadUnread } from './thread/noteThreadStore';
import { NoteThreadButton } from './thread/NoteThreadButton';
import { consumeThreadRequest, useThreadRequest } from './thread/threadDeepLink';
import { markNotepadPhase } from './notepadTiming';
import { prefetchMarkdownRenderer } from '@/features/shared/components/editors/DeferredMarkdown';
import {
  archivedNotes as archivedNotesOf,
  shippedNotes as shippedNotesOf,
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
import {
  useNotepadPlanLive,
  useNotepadPlanSummaries,
  useNotepadSaveStates,
  useNotepadStatus,
  useOpenNotes,
  useArchivedNotes,
  useShippedNotes,
} from './useNotepad';
import { noteBodyEditable, NOTE_PLAN_STATUSES } from './noteStatusMeta';
import { NotePlanProvider, PLAN_TABS, type PlanTab } from './plan/NotePlanContext';
import NoteBody from './NoteBody';
import { titleFromText } from './noteText';
// TEMPORARY (desk contest): the switcher wraps the baseline NoteOverview — see overview/v2/deskVariant.tsx.
import { NoteOverviewContest } from './overview/v2/deskVariant';
import type { NoteSeed } from './overview/types';

/** Layer 1 is every note as a card; layer 2 is one note in the full editor. */
type PadView = 'overview' | 'editor';

/** The breadcrumb's last crumb. Reuses the pane's OWN tab labels rather than a
 *  second set — the crumb and the tab strip must never disagree about what the
 *  tab is called. */
const PLAN_TAB_LABEL: Record<PlanTab, (t: Translations) => string> = {
  plan: (t) => t.notepad.plan_tab_plan,
  criteria: (t) => t.notepad.plan_tab_criteria,
  runs: (t) => t.notepad.plan_tab_runs,
};

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
  // THE DEEP LINK. Every retired "open the ship plan" door — the Mastermind
  // island menu, the milestone status bar, the passport cover's roadmap strip
  // — raises the pad through `notepadOpenForProject`, which leaves the project
  // here. Read ONCE at mount, because `NotepadLayer` renders this host only
  // while the pad is up, so mount IS the open; cleared in the effect below so a
  // later reopen starts on the whole desk rather than on a week-old click.
  const [pendingProject] = useState(() => useSystemStore.getState().notepadPendingProject);
  const clearPendingProject = useSystemStore((s) => s.notepadClearPendingProject);

  const notes = useOpenNotes();
  const archived = useArchivedNotes();
  // The drawer's second group. Read here rather than inside the lazy modal so
  // the modal stays a pure view of what the host already subscribes to.
  const shipped = useShippedNotes();
  const planSummaries = useNotepadPlanSummaries();
  // ONE subscriber for the whole pad — the plan join refetches per ship-table
  // revision, not per surface that reads it.
  useNotepadPlanLive();
  const saveStates = useNotepadSaveStates();
  const { loading, loaded } = useNotepadStatus();

  const [projects, setProjects] = useState<DevProject[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  // The pad always opens on the overview: a summoned surface should show
  // everything first, not drop you into whichever note you last touched.
  const [view, setView] = useState<PadView>('overview');
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  // The plan pane's tab, held HERE because `Ctrl+1/2/3` is registered at this
  // layer's keyboard priority and the pane is two levels down. Handed to
  // `NotePlanProvider`, which is how the pane reads it.
  const [planTab, setPlanTab] = useState<PlanTab>('plan');
  const rootRef = useRef<HTMLDivElement>(null);
  // The editor top row's thread popover, and the note a desk rail asked to
  // certify (the plan provider honours it once the milestone has loaded).
  const [editorThreadOpen, setEditorThreadOpen] = useState(false);
  const [certifyNoteId, setCertifyNoteId] = useState<string | null>(null);
  const clearCertify = useCallback(() => setCertifyNoteId(null), []);

  // First open fetches; later opens paint the notes already in memory and
  // refresh underneath them — a re-open must never re-ghost (loading law 1).
  useEffect(() => {
    markNotepadPhase('mount');
    // One frame after mount is the first moment the operator could have SEEN
    // the real pad; everything before it is work they were waiting through.
    const raf = requestAnimationFrame(() => {
      markNotepadPhase('paint');
      // The pad is on screen and the operator is about to type. Warm the
      // markdown chunk NOW, off the critical path, so the first preview toggle
      // — and Athena's first suggestion block — render immediately instead of
      // showing their raw-text fallback for a beat.
      prefetchMarkdownRenderer();
    });
    void load().finally(() => markNotepadPhase('notes'));
    // The desk's unread badges. Beside the notes read, never in its failure
    // path: a pad whose notes loaded must open even when the thread read fails.
    void loadThreadUnread();
    listProjects()
      .then(setProjects)
      .catch(silentCatch('notepad projects'))
      .finally(() => markNotepadPhase('projects'));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (pendingProject) clearPendingProject();
  }, [pendingProject, clearPendingProject]);

  const close = useCallback(() => {
    // Never close over a stranded debounce — the overlay unmounting is exactly
    // the moment the last keystrokes would have been lost.
    void flush().finally(() => setOpen(false));
  }, [setOpen]);

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

  // A linked note in a working state renders its PLAN, and the plan is fetched
  // ONCE — by a provider wrapping both halves of the editor, because the body
  // and the dispatch bar are siblings in this JSX and both read the same
  // milestone (`NotePlanContext` states the argument in full).
  //
  // Mounted only in the EDITOR view and only for such a note: a provider around
  // the overview would fetch a project's whole L2 slice while the operator is
  // browsing cards, which is the one thing the pad's cold-open budget cannot
  // afford.
  const planNote =
    view === 'editor' && active && activeProject && active.milestoneId
    && NOTE_PLAN_STATUSES.includes(active.status)
      ? { noteId: active.id, milestoneId: active.milestoneId, project: activeProject }
      : null;

  // Every plan note opens on its first tab. Keyed on the note, not the view: a
  // tab left on Runs would otherwise be the tab the NEXT note opens on, which is
  // a selection nobody made.
  useEffect(() => {
    setPlanTab('plan');
  }, [active?.id]);

  // Escape closes; Tab cycles inside the layer. Registered at a priority BELOW
  // BaseModal's 80 so a confirm dialog opened from here takes Escape first.
  const backToOverview = useCallback(() => {
    void flush(activeId ?? undefined);
    setView('overview');
  }, [activeId]);

  useAppKeyboard(
    (event) => {
      // Ctrl/Cmd+1..3 move the plan pane's tab, and ONLY while a plan note is
      // open — on any other note the browser's own meaning for the chord is
      // better than a shortcut that does nothing. Plain digits are left alone:
      // the pad is a place people type.
      if (planNote && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        // `Number('a')` is NaN and `PLAN_TABS[NaN]` is undefined, so the guard
        // below is the whole validation — no digit test needed.
        const target = PLAN_TABS[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          setPlanTab(target);
          return true;
        }
      }
      if (event.key === 'Escape') {
        // THE ESCAPE LADDER, one rung per press:
        //   popover → card caret → (the plan tab is NOT a rung) → editor → close
        //
        // A popover anywhere in the pad (a card's project picker, a ledger menu)
        // takes its own Escape first — it listens on `document`, this layer on
        // `window` — and marks it handled. Closing the layer under it would
        // throw away the whole surface to dismiss a menu, so a handled event
        // ends the ladder here in BOTH views. It used to end it only on the
        // overview, which meant a popover inside the editor lost its dismissal
        // to the back-step.
        if (event.defaultPrevented) return false;
        // The plan tab is deliberately not a rung: it is a VIEW of one note, not
        // a layer stacked over it, and making Escape unwind it would put two
        // presses between a plan note and the desk.
        if (view === 'editor') {
          backToOverview();
          return true;
        }
        const focused = document.activeElement;
        if (
          (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) &&
          rootRef.current?.contains(focused)
        ) {
          focused.blur();
          return true;
        }
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

  const openNote = useCallback(
    (id: string) => {
      void flush();
      setActiveNote(id);
      setView('editor');
    },
    [setActiveNote],
  );

  // Creating from the overview stays ON the overview: a seeded capture lands
  // as a finished card, an empty one takes the caret in its own card.
  const handleOverviewCreate = useCallback(
    async (seed?: NoteSeed) => {
      const title = seed?.bodyMd ? titleFromText(seed.bodyMd, t.notepad.new_note_title) : t.notepad.new_note_title;
      const created = await createNote(title, seed?.projectId ?? null);
      if (!created) return;
      if (seed?.bodyMd) patchNote(created.id, { bodyMd: seed.bodyMd });
      else setFocusNoteId(created.id);
    },
    [t.notepad.new_note_title],
  );

  // THE STACK'S DOOR (`openNotepadThread`): a LiveCommsStack entry opens the
  // pad on its note's editor with the thread popover up. Read on mount (the
  // request raised the pad) and on every later request while it is open. The
  // editor rather than the desk card because the card may be filtered out; the
  // editor's top row always carries the thread.
  const threadRequest = useThreadRequest();
  // The note a request just opened: the close-on-navigate effect below must not
  // shut the popover the request itself asked for.
  const requestedThread = useRef<string | null>(null);
  useEffect(() => {
    if (!threadRequest || !loaded) return;
    consumeThreadRequest();
    if (!notes.some((n) => n.id === threadRequest)) return;
    requestedThread.current = threadRequest;
    openNote(threadRequest);
    setEditorThreadOpen(true);
  }, [threadRequest, loaded, notes, openNote]);

  // A different note, or back to the desk, closes the editor's thread.
  useEffect(() => {
    if (view === 'editor' && requestedThread.current === active?.id) {
      requestedThread.current = null;
      return;
    }
    setEditorThreadOpen(false);
  }, [active?.id, view]);

  // A note deleted or archived out from under the editor has nothing to show.
  useEffect(() => {
    if (view === 'editor' && loaded && !active) setView('overview');
  }, [view, loaded, active]);

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

  const withPlan = (children: ReactNode) =>
    planNote ? (
      <NotePlanProvider
        noteId={planNote.noteId}
        milestoneId={planNote.milestoneId}
        project={planNote.project}
        tab={planTab}
        onTabChange={setPlanTab}
        certifyOnOpen={certifyNoteId === planNote.noteId}
        onCertifyConsumed={clearCertify}
      >
        {children}
      </NotePlanProvider>
    ) : (
      children
    );

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
        <div className="flex items-center gap-3 min-w-0">
          {view === 'editor' && (
            // ONE control, two readings. On an ordinary note it is the back
            // button it has always been; on a PLAN note it is the first crumb of
            // a breadcrumb, because a plan note is three levels deep (desk →
            // note → tab) and a bare arrow cannot say which of the three you are
            // on. The crumb and the button are the same element on purpose —
            // two ways back to the same place is one way too many.
            <nav
              aria-label={t.notepad.crumb_desk}
              className="flex items-center gap-1.5 min-w-0 typo-caption"
            >
              <button
                type="button"
                onClick={backToOverview}
                data-testid="notepad-back-overview"
                className="h-7 px-2 -ml-2 rounded-input flex items-center gap-1.5 text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors focus-ring"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden />
                {planNote ? t.notepad.crumb_desk : t.notepad.overview_back}
              </button>
              {planNote && active && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-foreground opacity-50" aria-hidden />
                  <span className="truncate max-w-[24ch] text-foreground/85" data-testid="notepad-crumb-note">
                    {active.title}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-foreground opacity-50" aria-hidden />
                  <span aria-current="page" className="text-foreground" data-testid="notepad-crumb-tab">
                    {PLAN_TAB_LABEL[planTab](t)}
                  </span>
                </>
              )}
            </nav>
          )}
          <span className="flex items-center gap-2 typo-caption text-foreground/60">
            <NotepadText className="w-4 h-4" aria-hidden />
            {t.notepad.title}
          </span>
        </div>

        <div className="flex items-center gap-2">
        {view === 'editor' && active && (
          <NoteThreadButton
            noteId={active.id}
            noteTitle={active.title}
            open={editorThreadOpen}
            onOpenChange={setEditorThreadOpen}
            testId="notepad-editor-thread"
          />
        )}
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
      </div>

      {withPlan(
        <>
      {view === 'overview' ? (
        showEmpty ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={NotepadText}
              title={t.notepad.empty_title}
              subtitle={t.notepad.empty_subtitle}
              action={{ label: t.notepad.empty_action, onClick: () => void handleOverviewCreate() }}
            />
          </div>
        ) : (
          <NoteOverviewContest
            loading={showGhost}
            notes={notes}
            projects={projects}
            saveStates={saveStates}
            atCap={atCap}
            focusNoteId={focusNoteId}
            initialProjectId={pendingProject}
            onOpen={openNote}
            onPatch={patchNote}
            onCreate={(seed) => void handleOverviewCreate(seed)}
            onDelete={(note) => handleDelete(note, true)}
            onCertify={(id) => {
              setCertifyNoteId(id);
              openNote(id);
            }}
          />
        )
      ) : showGhost ? (
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
                    // The server's rule, mirrored: a body is writable in
                    // `draft | scoped | cut`. It used to read `!== 'draft'`,
                    // which would have locked a brief the moment it became one.
                    readOnly={!noteBodyEditable(active.status)}
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

      {view === 'overview' ? null : showEmpty ? (
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
        </>,
      )}

      {archiveOpen && (
        <Suspense fallback={null}>
        <NoteArchiveModal
          notes={archived.length > 0 ? archived : archivedNotesOf()}
          shipped={shipped.length > 0 ? shipped : shippedNotesOf()}
          summaries={planSummaries}
          atCap={atCap}
          onRestore={async (id) => {
            await restoreNote(id);
          }}
          onFork={async (id) => {
            await forkNote(id);
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
