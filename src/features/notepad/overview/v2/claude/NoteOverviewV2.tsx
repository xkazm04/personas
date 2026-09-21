// Layer 1 of the pad, v2 ("claude"): the desk as an instrument.
//
// Same props, same state ownership and the same card parts as the baseline
// `NoteOverview` — everything it could do is still one click away. What v2 adds
// is a keyboard that drives the whole desk:
//
//   - ONE line with two modes (Write captures, Find filters), `/` between them;
//   - a single cursor halo that glides across the grid (arrows, j/k, Home/End);
//   - verbs on the selected card (`a` `r` `t` `y` `n` `s` `p` `g` `i` `m` `e` Del);
//   - a status line whose chips are the available verbs, and a `?` HUD that
//     stays up while you practise.
//
// KEYBOARD CONTRACT (brief § Hard rules):
//   - one `useAppKeyboard` registration at NOTEPAD_LAYER_PRIORITY. It is armed a
//     frame after mount so its registration id is higher than the host's — at an
//     equal priority the registry runs the newer handler first, and the desk
//     must see Escape before the host's ladder closes the pad under a live
//     filter or an open HUD.
//   - nothing single-key fires while focus is in an input, textarea or
//     contenteditable (`resolveDeskKey` answers null there, without exception).
//   - `true` only when the key was handled; Escape is `preventDefault`-ed when
//     consumed, so the host's ladder (which stops at a prevented event) agrees.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { NoResults } from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { archiveNote, NOTE_CAP } from '../../../notepadStore';
import { NOTEPAD_POPOVER_Z } from '../../../notepadLayers';
import { noteOccupiesSlot, noteStatusMeta } from '../../../noteStatusMeta';
import { publishFleet, toGoals, type NoteDispatchResult } from '../../../notepadActions';
import { noteAskBlockedReasonKey, noteDeleteBlocked } from '../../../noteGuards';
import { useNotepadPlanSummaries, useNotepadStatus } from '../../../useNotepad';
import { fetchThread, threadOf, useNoteUnreadMap } from '../../../thread/noteThreadStore';
import { approveReview, rejectReview } from '../../../thread/threadActions';
import { isPendingReview } from '../../../thread/threadLabels';
import { useNotesWorkingMap } from '../../../thread/useNoteWorking';
import { deskForecasts } from '../../deskForecast';
import { DESK_FILTERS, matchesDeskFilter, readDeskFilter, writeDeskFilter, type DeskFilter } from '../../deskFilter';
import { OverviewGhost } from '../../parts/NoteCardBits';
import { noteCardMenuItems } from '../../parts/NoteCardMenu';
import { railNextStep, type RailNext } from '../../parts/NoteLifecycleRail';
import type { NoteOverviewProps } from '../../types';
import { CardComposer, type ComposerRequest } from './CardComposer';
import { CommandBar, type DeskChip, type DeskMode } from './CommandBar';
import { CommandLine, type LineMode } from './CommandLine';
import { COPY } from './copy';
import { CursorHalo } from './CursorHalo';
import { availableDeskActions } from './deskActions';
import { DeskCardV2 } from './DeskCardV2';
import {
  cycleId,
  inferColumns,
  isTopRow,
  matchNote,
  moveIndex,
  reconcileSelection,
  resolveDeskKey,
  STATUS_KEYS,
  type DeskAction,
  type DeskSelection,
  type NoteMatch,
} from './deskKeyModel';
import { Keycap } from './Keycap';
import { KeysHud } from './KeysHud';
import { useDeskBubbles } from './useDeskBubbles';

const ALL = '__all';
const NONE = '__none';
const NO_RANGES: ReadonlyArray<readonly [number, number]> = [];

const FILTER_LABEL: Record<DeskFilter, (t: Translations) => string> = {
  drafts: (t) => t.notepad.desk_filter_drafts,
  scoped: (t) => t.notepad.desk_filter_scoped,
  all: (t) => t.common.all,
};

/** Shortcut hints the right-click menu shows beside its rows. */
const MENU_SHORTCUTS: Readonly<Record<string, string>> = {
  open: '↵',
  ask: 'A',
  publish: 'P',
  goals: 'G',
  archive: 'E',
  delete: COPY.keycap_del,
};

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

/** A control that owns Enter itself. */
function isControl(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="option"]') !== null;
}

/** The newest review still waiting on the operator: the bubble's, else the thread's. */
async function findPendingReview(noteId: string, bubble: NoteComment | undefined): Promise<NoteComment | null> {
  if (bubble && isPendingReview(bubble)) return bubble;
  let entries = threadOf(noteId)?.entries;
  if (!entries || entries.length === 0) {
    await fetchThread(noteId);
    entries = threadOf(noteId)?.entries ?? [];
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (isPendingReview(entry)) return entry;
  }
  return null;
}

/** The cap as a row of pips — the count in words stays beside it. */
function SlotMeter({ used, cap, reduced }: { used: number; cap: number; reduced: boolean }) {
  const full = used >= cap;
  return (
    <div className="flex items-center gap-1" aria-hidden data-testid="notepad-v2c-slots">
      {Array.from({ length: cap }, (_, i) => {
        const on = i < used;
        return (
          <motion.span
            key={i}
            className={`h-2.5 w-1.5 rounded-full transition-colors duration-300 ${
              on ? (full ? 'bg-status-warning' : 'bg-primary') : 'bg-secondary/50'
            }`}
            initial={false}
            animate={{ scaleY: on ? 1 : 0.6, opacity: on ? 1 : 0.7 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 26, delay: i * 0.02 }}
          />
        );
      })}
    </div>
  );
}

export function NoteOverviewV2({
  loading,
  notes,
  projects,
  saveStates,
  atCap,
  focusNoteId,
  initialProjectId,
  onOpen,
  onPatch,
  onCreate,
  onDelete,
  onCertify,
}: NoteOverviewProps & { loading: boolean }) {
  const { t, tx } = useTranslation();
  const enter = useRevealTracker();
  const reduced = useReducedMotion();
  const working = useNotesWorkingMap();
  const unread = useNoteUnreadMap();
  // The whole list by reference, as the baseline menu reads it: the delete gate
  // needs every session's name and state.
  const fleetSessions = useSystemStore((s) => s.fleetSessions);
  const { bubbles, dismiss: dismissBubble } = useDeskBubbles();

  const [filter, setFilter] = useState<string>(() => initialProjectId ?? ALL);
  const [status, setStatus] = useState<DeskFilter>(readDeskFilter);
  const [capture, setCapture] = useState('');
  const [query, setQuery] = useState('');
  const [lineMode, setLineMode] = useState<LineMode>('write');
  const [lineFocused, setLineFocused] = useState(false);
  const [editingCard, setEditingCard] = useState(false);
  const [selection, setSelection] = useState<DeskSelection>({ id: null, index: -1 });
  const [keysOpen, setKeysOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ noteId: string; x: number; y: number } | null>(null);
  const [composer, setComposer] = useState<ComposerRequest | null>(null);
  const [armed, setArmed] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLInputElement>(null);

  // A note just created from the desk takes the cursor (it already takes the
  // caret, through the card's quick-write). Adjusted during render — the React
  // pattern for "state that follows a prop" — rather than in an effect.
  const [seenFocus, setSeenFocus] = useState(focusNoteId);
  if (focusNoteId !== seenFocus) {
    setSeenFocus(focusNoteId);
    if (focusNoteId) setSelection({ id: focusNoteId, index: 0 });
  }

  // See the file header: registered one frame late on purpose.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // --- derivation (the baseline's, plus the Find query) ----------------------

  const slotCount = useMemo(() => notes.filter((n) => noteOccupiesSlot(n.status)).length, [notes]);
  const summaries = useNotepadPlanSummaries();
  const { planSummariesStale } = useNotepadStatus();

  const inRail = useMemo(() => notes.filter((n) => matchesDeskFilter(n.status, status)), [notes, status]);

  const tabs = useMemo(() => {
    const used = projects.filter((p) => inRail.some((n) => n.projectId === p.id));
    const unmapped = inRail.filter((n) => !n.projectId).length;
    return [
      { id: ALL, label: `${t.common.all} · ${inRail.length}` },
      ...used.map((p) => ({ id: p.id, label: `${p.name} · ${inRail.filter((n) => n.projectId === p.id).length}` })),
      ...(unmapped > 0 ? [{ id: NONE, label: `${t.notepad.project_none} · ${unmapped}` }] : []),
    ];
  }, [inRail, projects, t]);

  const statusTabs = useMemo(
    () =>
      DESK_FILTERS.map((id, i) => ({
        id,
        ariaLabel: FILTER_LABEL[id](t),
        label: (
          <span className="flex items-center gap-1.5">
            {FILTER_LABEL[id](t)}
            <Keycap className="opacity-70">{STATUS_KEYS[i]}</Keycap>
          </span>
        ),
      })),
    [t],
  );

  const active = tabs.some((tab) => tab.id === filter) ? filter : ALL;
  const inProject = useMemo(
    () => inRail.filter((n) => (active === ALL ? true : active === NONE ? !n.projectId : n.projectId === active)),
    [inRail, active],
  );

  const finding = lineMode === 'find' && query.trim() !== '';
  const matches = useMemo(() => {
    const out = new Map<string, NoteMatch>();
    if (!finding) return out;
    for (const n of inProject) {
      const m = matchNote(query, n.title, n.bodyMd);
      if (m) out.set(n.id, m);
    }
    return out;
  }, [finding, inProject, query]);
  // Desk order is kept while filtering: spatial memory beats rank on a desk of
  // ten, and the reflow animates the narrowing instead of reshuffling it.
  const visible = useMemo(() => (finding ? inProject.filter((n) => matches.has(n.id)) : inProject), [finding, inProject, matches]);
  const ids = useMemo(() => visible.map((n) => n.id), [visible]);

  // The cursor, reconciled against what is on screen (pure: `reconcileSelection`).
  // The stored selection keeps the last note the operator chose, so a note
  // filtered away and brought back gets the cursor back too.
  const sel = reconcileSelection(selection, ids);
  const selectedNote = sel.id ? visible[sel.index] ?? null : null;

  const forecasts = useMemo(
    () => (planSummariesStale ? {} : deskForecasts(notes, summaries)),
    [notes, summaries, planSummariesStale],
  );

  // --- focus helpers ---------------------------------------------------------

  const focusDesk = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const focusLine = useCallback(
    (mode: LineMode) => {
      setLineMode(mode);
      // Write and Find never share a filter: capturing while a filter hides
      // cards would drop the new draft somewhere the operator cannot see it.
      if (mode === 'write') setQuery('');
      requestAnimationFrame(() => lineRef.current?.focus());
    },
    [],
  );

  const select = useCallback(
    (id: string) => {
      const index = ids.indexOf(id);
      if (index >= 0) setSelection({ id, index });
    },
    [ids],
  );

  // The selected card scrolls into view — `nearest`, so a card already on
  // screen does not move.
  useEffect(() => {
    if (!sel.id) return;
    const slot = gridRef.current?.querySelector<HTMLElement>(`[data-slot="${sel.id}"]`);
    slot?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [sel.id, reduced]);

  // --- verbs -----------------------------------------------------------------

  const toast = useCallback((message: string, kind: 'success' | 'warning') => {
    useToastStore.getState().addToast(message, kind);
  }, []);

  const projectOf = useCallback((note: DevNote) => projects.find((p) => p.id === note.projectId) ?? null, [projects]);

  /** The baseline card's refusal sentence for a precondition that moved under the key. */
  const run = useCallback(
    async (note: DevNote, fn: () => Promise<NoteDispatchResult>) => {
      const r = await fn();
      if (!r.ok && r.pending) toast(note.projectId ? t.notepad.dispatch_needs_draft : t.notepad.dispatch_needs_project, 'warning');
    },
    [t, toast],
  );

  const advance = useCallback(
    async (note: DevNote, next: RailNext) => {
      const project = projectOf(note);
      if (next.action === 'publish') return run(note, () => publishFleet(note, project));
      if (next.action === 'goals') return run(note, () => toGoals(note, project));
      onCertify(note.id);
    },
    [projectOf, run, onCertify],
  );

  const settleReview = useCallback(
    async (note: DevNote, verdict: 'approve' | 'reject') => {
      const review = await findPendingReview(note.id, bubbles[note.id]);
      if (!review) {
        toast(COPY.no_review, 'warning');
        return;
      }
      if (verdict === 'approve') {
        const r = await approveReview(review);
        if (r.ok) {
          dismissBubble(note.id);
          toast(COPY.approved, 'success');
        }
        return;
      }
      // A run's rejection re-runs the note, and a re-run needs to be told why.
      if (review.refKind === 'run') {
        setComposer({ noteId: note.id, mode: 'reject', entry: review });
        return;
      }
      const r = await rejectReview(review);
      if (r.ok) {
        dismissBubble(note.id);
        toast(COPY.rejected, 'success');
      }
    },
    [bubbles, dismissBubble, toast],
  );

  const slotOf = useCallback(
    (noteId: string) => gridRef.current?.querySelector<HTMLElement>(`[data-slot="${noteId}"]`) ?? null,
    [],
  );

  const doAction = useCallback(
    (action: DeskAction, note: DevNote) => {
      const project = projectOf(note);
      switch (action) {
        case 'open':
          onOpen(note.id);
          return;
        case 'ask': {
          const blocked = noteAskBlockedReasonKey(note);
          if (blocked) toast(t.notepad[blocked], 'warning');
          else setComposer({ noteId: note.id, mode: 'ask' });
          return;
        }
        case 'reply':
          setComposer({ noteId: note.id, mode: 'reply', entry: bubbles[note.id] });
          return;
        case 'thread':
          dismissBubble(note.id);
          setThreadId(note.id);
          return;
        case 'approve':
        case 'reject':
          void settleReview(note, action);
          return;
        case 'publish':
          void run(note, () => publishFleet(note, project));
          return;
        case 'goals':
          void run(note, () => toGoals(note, project));
          return;
        case 'step': {
          const next = railNextStep(note);
          if (!next) return;
          if (next.blockedKey) toast(t.notepad[next.blockedKey], 'warning');
          else void advance(note, next);
          return;
        }
        case 'edit': {
          const field = slotOf(note.id)?.querySelector<HTMLElement>('[contenteditable="true"]');
          if (!field) {
            toast(COPY.edit_locked, 'warning');
            return;
          }
          field.focus();
          // Caret at the end: "write on the card" continues the text.
          const range = document.createRange();
          range.selectNodeContents(field);
          range.collapse(false);
          const selectionApi = window.getSelection();
          selectionApi?.removeAllRanges();
          selectionApi?.addRange(range);
          return;
        }
        case 'menu': {
          const rect = slotOf(note.id)?.getBoundingClientRect();
          setMenu({ noteId: note.id, x: (rect?.left ?? 0) + 16, y: (rect?.top ?? 0) + 52 });
          return;
        }
        case 'archive':
          void archiveNote(note.id).then((archived) => {
            if (archived) toast(COPY.archived, 'success');
          });
          return;
        case 'delete':
          if (noteDeleteBlocked(note, fleetSessions)) toast(t.notepad.menu_delete_blocked_running, 'warning');
          else onDelete(note);
          return;
      }
    },
    [projectOf, onOpen, toast, t, bubbles, dismissBubble, settleReview, run, advance, slotOf, fleetSessions, onDelete],
  );

  const pickStatus = useCallback((next: DeskFilter) => {
    setStatus(next);
    writeDeskFilter(next);
  }, []);

  const submitLine = () => {
    if (lineMode === 'write') {
      const text = capture.trim();
      if (!text || atCap) return;
      onCreate({ bodyMd: text, projectId: active === ALL || active === NONE ? null : active });
      setCapture('');
      return;
    }
    const target = selectedNote ?? visible[0];
    if (target) {
      onOpen(target.id);
      return;
    }
    // Find found nothing: the query becomes the note (Notational Velocity's
    // search-or-create, one keystroke).
    const text = query.trim();
    if (text && visible.length === 0 && !atCap) {
      onCreate({ bodyMd: text, projectId: active === ALL || active === NONE ? null : active });
      setQuery('');
      setLineMode('write');
    }
  };

  /** Typing a query with no cursor yet puts it on the first match, so the
   *  card Enter will open is always the one lit up. */
  const changeQuery = (next: string) => {
    setQuery(next);
    if (selection.id || !next.trim()) return;
    const index = inProject.findIndex((n) => matchNote(next, n.title, n.bodyMd) !== null);
    if (index >= 0) setSelection({ id: inProject[index]!.id, index: 0 });
  };

  const dropToGrid = () => {
    lineRef.current?.blur();
    focusDesk();
    if (!sel.id && ids.length > 0) setSelection({ id: ids[0]!, index: 0 });
  };

  // --- the keyboard ----------------------------------------------------------

  const overlayOpen = menu !== null || composer !== null || threadId !== null;

  useAppKeyboard(
    (event) => {
      if (event.defaultPrevented || loading) return false;
      const target = event.target instanceof Element ? event.target : null;
      // Keys that happen inside another surface (a confirm dialog, the thread
      // popover, a portalled menu) are that surface's.
      if (target && target !== document.body && !rootRef.current?.contains(target)) return false;

      const cmd = resolveDeskKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        editable: isEditable(target),
        control: isControl(target),
      });
      if (!cmd) return false;

      switch (cmd.type) {
        case 'escape':
          // THE DESK'S RUNGS, above the host's ladder: HUD → Find query → (host:
          // blur a field → close the pad).
          if (keysOpen) setKeysOpen(false);
          else if (query) setQuery('');
          else return false;
          break;
        case 'keys':
          setKeysOpen((open) => !open);
          break;
        case 'find':
          focusLine('find');
          break;
        case 'write':
          if (atCap) {
            toast(tx(t.notepad.cap_reached, { count: slotCount }), 'warning');
            break;
          }
          focusLine('write');
          break;
        case 'status':
          pickStatus(DESK_FILTERS[cmd.index]!);
          break;
        case 'project':
          setFilter(cmd.step === 0 ? ALL : cycleId(tabs.map((tab) => tab.id), active, cmd.step));
          break;
        case 'move': {
          if (ids.length === 0) return false;
          const cols = inferColumns(ids.map((id) => slotOf(id)?.offsetTop ?? 0));
          if (cmd.dir === 'up' && isTopRow(sel.index, cols)) {
            // Up from the top row climbs back into the line.
            focusLine(lineMode);
            break;
          }
          const next = moveIndex(sel.index, ids.length, cols, cmd.dir);
          if (next >= 0) setSelection({ id: ids[next]!, index: next });
          // A move owns the keyboard again: leave any card button focus behind.
          if (target && target !== rootRef.current) focusDesk();
          break;
        }
        case 'action':
          if (!selectedNote) {
            // Nothing selected: the first verb shows the cursor rather than
            // acting on a note the operator never pointed at.
            if (ids.length === 0) return false;
            setSelection({ id: ids[0]!, index: 0 });
            break;
          }
          doAction(cmd.action, selectedNote);
          break;
      }
      event.preventDefault();
      return true;
    },
    { enabled: armed && !overlayOpen, priority: NOTEPAD_LAYER_PRIORITY },
  );

  // --- derived chrome --------------------------------------------------------

  const menuNote = menu ? notes.find((n) => n.id === menu.noteId) ?? null : null;
  const composerNote = composer ? notes.find((n) => n.id === composer.noteId) ?? null : null;

  const available = useMemo(
    () =>
      selectedNote
        ? availableDeskActions(selectedNote, {
            deleteBlocked: noteDeleteBlocked(selectedNote, fleetSessions),
            pendingReview: Boolean(bubbles[selectedNote.id] && isPendingReview(bubbles[selectedNote.id]!)),
          })
        : new Set<DeskAction>(),
    [selectedNote, fleetSessions, bubbles],
  );

  const chips = useMemo<DeskChip[]>(() => {
    if (!selectedNote) return [];
    const note = selectedNote;
    const out: DeskChip[] = [{ id: 'open', keyFace: '↵', label: COPY.chip_open, tone: 'accent', onRun: () => doAction('open', note) }];
    if (available.has('approve')) {
      out.push({ id: 'approve', keyFace: 'y', label: t.notepad.review_approve, tone: 'warning', onRun: () => doAction('approve', note) });
      out.push({ id: 'reject', keyFace: 'n', label: t.notepad.review_reject, tone: 'warning', onRun: () => doAction('reject', note) });
    }
    const next = railNextStep(note);
    if (available.has('step') && next) {
      const label = tx(t.notepad.rail_move_to, { status: noteStatusMeta(next.status).labelKey(t) });
      out.push({ id: 'step', keyFace: 's', label, onRun: () => doAction('step', note) });
    }
    if (available.has('ask')) out.push({ id: 'ask', keyFace: 'a', label: COPY.chip_ask, onRun: () => doAction('ask', note) });
    if (available.has('edit')) out.push({ id: 'edit', keyFace: 'i', label: COPY.chip_edit, onRun: () => doAction('edit', note) });
    out.push({ id: 'thread', keyFace: 't', label: COPY.chip_thread, count: unread[note.id] ?? 0, onRun: () => doAction('thread', note) });
    out.push({ id: 'reply', keyFace: 'r', label: COPY.chip_reply, onRun: () => doAction('reply', note) });
    return out;
  }, [selectedNote, available, doAction, t, tx, unread]);

  const deskMode: DeskMode = lineFocused ? lineMode : editingCard ? 'write' : finding ? 'find' : 'browse';

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menuNote) return [];
    const note = menuNote;
    return noteCardMenuItems(note, fleetSessions, t, {
      onOpen: () => onOpen(note.id),
      onAsk: () => doAction('ask', note),
      onPublish: () => doAction('publish', note),
      onToGoals: () => doAction('goals', note),
      onArchive: () => doAction('archive', note),
      onDelete: () => onDelete(note),
    }).map((item) => ({ ...item, shortcut: MENU_SHORTCUTS[item.id] }));
  }, [menuNote, fleetSessions, t, onOpen, doAction, onDelete]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    focusDesk();
  }, [focusDesk]);

  const resetFilters = () => {
    setQuery('');
    setFilter(ALL);
    pickStatus('all');
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative flex-1 min-h-0 flex flex-col outline-none"
      data-testid="notepad-overview"
      data-variant="v2-claude"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-8 pt-6 pb-12 flex flex-col gap-5">
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <h2 className="typo-heading-lg text-foreground">{t.notepad.tabs_label}</h2>
              <span className="typo-caption text-foreground/85">
                {tx(t.notepad.overview_count, { count: slotCount, cap: NOTE_CAP })}
              </span>
            </div>
            <SlotMeter used={slotCount} cap={NOTE_CAP} reduced={reduced} />
          </div>

          <div
            onFocusCapture={(e) => setLineFocused(e.target instanceof HTMLInputElement)}
            onBlurCapture={() => setLineFocused(false)}
          >
            <CommandLine
              ref={lineRef}
              mode={lineMode}
              capture={capture}
              query={query}
              atCap={atCap}
              slotCount={slotCount}
              shown={visible.length}
              total={inProject.length}
              onCaptureChange={setCapture}
              onQueryChange={changeQuery}
              onModeChange={focusLine}
              onSubmit={submitLine}
              onDropToGrid={dropToGrid}
              onStepOut={() => {
                setLineMode('write');
                lineRef.current?.blur();
                focusDesk();
              }}
            />
          </div>

          {!loading && (
            <div className="flex items-center gap-3 flex-wrap">
              <SegmentedTabs
                tabs={statusTabs}
                activeTab={status}
                onTabChange={pickStatus}
                size="sm"
                fullWidth={false}
                ariaLabel={t.notepad.desk_filter_label}
                layoutId="notepad-v2c-status"
                idPrefix="notepad-v2c-status"
              />
              {tabs.length > 2 && (
                <div className="flex items-center gap-2">
                  <SegmentedTabs
                    tabs={tabs}
                    activeTab={active}
                    onTabChange={setFilter}
                    size="sm"
                    fullWidth={false}
                    ariaLabel={t.notepad.project_label}
                    layoutId="notepad-v2c-project"
                    idPrefix="notepad-v2c-project"
                  />
                  <span className="flex items-center gap-0.5 opacity-70">
                    <Keycap>[</Keycap>
                    <Keycap>]</Keycap>
                  </span>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <OverviewGhost />
          ) : visible.length === 0 ? (
            <NoResults
              onReset={resetFilters}
              title={finding ? tx(COPY.find_no_match_title, { query: query.trim() }) : COPY.filters_empty_title}
              subtitle={finding && !atCap ? COPY.find_no_match_create : undefined}
              resetLabel={COPY.filters_reset}
            />
          ) : (
            <LayoutGroup id="notepad-v2c">
              <div
                ref={gridRef}
                role="tabpanel"
                id={`notepad-v2c-project-panel-${active}`}
                aria-labelledby={`notepad-v2c-project-tab-${active}`}
                className="relative grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-5"
                onFocusCapture={(e) => setEditingCard(isEditable(e.target))}
                onBlurCapture={() => setEditingCard(false)}
              >
                <CursorHalo gridRef={gridRef} selectedId={sel.id} layoutKey={ids.join('|')} reduced={reduced} />
                <AnimatePresence initial={false} mode="popLayout">
                  {visible.map((note, index) => {
                    const isSelected = note.id === sel.id;
                    const raised = isSelected || composer?.noteId === note.id || Boolean(bubbles[note.id]);
                    return (
                      <motion.div
                        key={note.id}
                        layout={!reduced}
                        data-slot={note.id}
                        className={`relative ${raised ? 'z-20' : 'z-0'}`}
                        initial={!reduced && enter.hasEntered(note.id) ? { opacity: 0, scale: 0.96 } : false}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
                        data-testid={`notepad-card-slot-${note.id}`}
                      >
                        <DeskCardV2
                          note={note}
                          projects={projects}
                          saveState={saveStates[note.id] ?? 'clean'}
                          summary={summaries[note.id]}
                          forecast={forecasts[note.id]}
                          working={working[note.id]}
                          order={index}
                          reveal={enter}
                          autoFocus={note.id === focusNoteId}
                          selected={isSelected}
                          titleRanges={matches.get(note.id)?.titleRanges ?? NO_RANGES}
                          threadOpen={threadId === note.id}
                          onThreadOpenChange={(open) => setThreadId(open ? note.id : null)}
                          bubble={bubbles[note.id] ?? null}
                          dismissBubble={dismissBubble}
                          onOpen={() => onOpen(note.id)}
                          onPatch={(patch) => onPatch(note.id, patch)}
                          onAdvance={(next) => advance(note, next)}
                          onSelect={() => select(note.id)}
                          onMenu={(x, y) => setMenu({ noteId: note.id, x, y })}
                          composer={
                            composer && composerNote && composer.noteId === note.id ? (
                              <CardComposer
                                key={`composer-${composer.mode}`}
                                note={composerNote}
                                project={projectOf(composerNote)}
                                request={composer}
                                onClose={(sent) => {
                                  if (sent && composer.mode !== 'ask') dismissBubble(note.id);
                                  setComposer(null);
                                  focusDesk();
                                }}
                              />
                            ) : null
                          }
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </LayoutGroup>
          )}
        </div>
      </div>

      <CommandBar
        mode={deskMode}
        selected={selectedNote}
        chips={chips}
        keysOpen={keysOpen}
        onToggleKeys={() => setKeysOpen((open) => !open)}
      />

      <AnimatePresence>
        {keysOpen && <KeysHud key="keys" available={available} onClose={() => setKeysOpen(false)} />}
      </AnimatePresence>

      <div className="sr-only" aria-live="polite" data-testid="notepad-v2c-announce">
        {selectedNote ? tx(COPY.selected_announce, { title: selectedNote.title }) : ''}
      </div>

      {menu &&
        menuNote &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={closeMenu}
            ariaLabel={t.notepad.menu_label}
            widthClass="w-64"
            zIndex={NOTEPAD_POPOVER_Z}
          />,
          document.body,
        )}
    </div>
  );
}
