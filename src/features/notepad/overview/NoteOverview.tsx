import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { CornerDownLeft, Search, Sparkles } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { NOTE_CAP } from '../notepadStore';
import { noteOccupiesSlot } from '../noteStatusMeta';
import { useNotepadPlanSummaries, useNotepadStatus } from '../useNotepad';
import { useNotesWorkingMap } from '../thread/useNoteWorking';
import { deskForecasts } from './deskForecast';
import { DESK_FILTERS, matchesDeskFilter, readDeskFilter, writeDeskFilter, type DeskFilter } from './deskFilter';
import {
  chromeReducer,
  INITIAL_CHROME,
  matchesQuery,
  PROJECT_ALL,
  PROJECT_NONE,
  scoreMatch,
  type CardAction,
} from './deskModel';
import { NoteDeskCard, type CardCommand } from './NoteDeskCard';
import { DeskCheatSheet } from './parts/DeskCheatSheet';
import { DeskHintRail } from './parts/DeskHintRail';
import { DESK_KEY, Keycap } from './parts/Keycap';
import { OverviewGhost } from './parts/NoteCardBits';
import type { NoteOverviewProps } from './types';
import { useDeskKeyboard, useGridColumns } from './useDeskKeyboard';

/** Resolved against the live translations, never stored as text — the same rule
 *  `noteStatusMeta.labelKey` follows for the status table. */
const FILTER_LABEL: Record<DeskFilter, (t: Translations) => string> = {
  drafts: (t) => t.notepad.desk_filter_drafts,
  scoped: (t) => t.notepad.desk_filter_scoped,
  all: (t) => t.common.all,
};

const STATUS_KEYS = [DESK_KEY.rail1, DESK_KEY.rail2, DESK_KEY.rail3] as const;

/**
 * Layer 1 of the pad — the desk. Every open note as a card; a card opens layer
 * 2, the full editor (`NoteBody` with its tab strip and dispatch bar).
 *
 * A note in this app is thinking ABOUT a repository, so the desk is organised
 * by repository: a filter strip of the projects the notes point at, and a
 * capture line that drops a draft straight into whichever project is selected.
 * TWO filters, because there are two rails: the project one says WHICH
 * repository, the status one says WHICH RAIL (see `deskFilter.ts`). They
 * compose; neither is the other's sub-menu.
 *
 * KEYBOARD-FIRST — the lamp on the blotter. Cards sit in a recessed well; a
 * primary lamp slides from card to card (`layoutId`) to mark the selected note,
 * which lifts. The operator drives the grid with the keys: arrows / `hjkl`
 * move, `/` finds across title and body, `1–3` switch rails (each status tab
 * wears its digit as a keycap), and every card verb is a single key. The hint
 * rail under the grid shows the keys that apply to the selected note right now;
 * `?` opens the whole map. The mouse still reaches every verb on the card. The
 * pure reducer and keymap are `deskModel.ts`; the keyboard layer is
 * `useDeskKeyboard.ts`.
 */
export function NoteOverview({
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
  // ONE presence subscription for the whole grid (a fleet heartbeat re-derives
  // once, not once per card).
  const working = useNotesWorkingMap();
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Seeded ONCE, from a deep link. `useState`'s initializer rather than an
  // effect: an effect would fight the operator the moment they picked a
  // different project and the prop had not changed.
  const [filter, setFilter] = useState<string>(() => initialProjectId ?? PROJECT_ALL);
  const [status, setStatus] = useState<DeskFilter>(readDeskFilter);
  const [capture, setCapture] = useState('');
  const [chrome, dispatch] = useReducer(chromeReducer, INITIAL_CHROME);
  const [command, setCommand] = useState<(CardCommand & { noteId: string }) | null>(null);
  const [pendingReview, setPendingReview] = useState(false);
  const commandSeq = useRef(0);

  // What the CAP counts, which is not `notes.length`: a completed report and a
  // shipped milestone hold no slot (`noteOccupiesSlot` cites the server's own
  // predicate). Counting them here is how "12 of 10 notes" gets rendered.
  const slotCount = useMemo(() => notes.filter((n) => noteOccupiesSlot(n.status)).length, [notes]);

  const summaries = useNotepadPlanSummaries();
  const { planSummariesStale } = useNotepadStatus();

  // Status first: the project tabs count what the status lens admits, so the
  // two filters agree about what "· 4" means.
  const inRail = useMemo(() => notes.filter((n) => matchesDeskFilter(n.status, status)), [notes, status]);

  const tabs = useMemo(() => {
    const used = projects.filter((p) => inRail.some((n) => n.projectId === p.id));
    const unmapped = inRail.filter((n) => !n.projectId).length;
    return [
      { id: PROJECT_ALL, label: `${t.common.all} · ${inRail.length}` },
      ...used.map((p) => ({ id: p.id, label: `${p.name} · ${inRail.filter((n) => n.projectId === p.id).length}` })),
      ...(unmapped > 0 ? [{ id: PROJECT_NONE, label: `${t.notepad.project_none} · ${unmapped}` }] : []),
    ];
  }, [inRail, projects, t]);

  const statusTabs = useMemo(
    () =>
      DESK_FILTERS.map((id, i) => ({
        id,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <Keycap>{STATUS_KEYS[i]}</Keycap>
            {FILTER_LABEL[id](t)}
          </span>
        ),
      })),
    [t],
  );

  // A filter can outlive its last note (archived, re-mapped) — fall back to All.
  const active = tabs.some((tab) => tab.id === filter) ? filter : PROJECT_ALL;
  // Memoized, not derived inline: `visibleIds` keys the selection-survival
  // effect, and a fresh array every render would re-run it every render.
  const inProject = useMemo(
    () =>
      inRail.filter((n) =>
        active === PROJECT_ALL ? true : active === PROJECT_NONE ? !n.projectId : n.projectId === active,
      ),
    [inRail, active],
  );

  // Find narrows WITHIN the rail + project, then ranks: title prefix beats
  // title contains beats body (`scoreMatch`).
  const ranked = useMemo(() => {
    const q = chrome.query;
    const matched = q.trim()
      ? inProject.filter((n) => matchesQuery(q, n.title, n.bodyMd))
      : inProject;
    if (!q.trim()) return matched;
    return [...matched].sort((a, b) => scoreMatch(q, b.title, b.bodyMd) - scoreMatch(q, a.title, a.bodyMd));
  }, [inProject, chrome.query]);

  const visible = ranked;
  const visibleIds = useMemo(() => visible.map((n) => n.id), [visible]);
  const visibleKey = visibleIds.join('|');

  // Derived over the WHOLE open set, not the visible slice: a project's cycle
  // evidence does not change because the operator narrowed the desk. Suppressed
  // entirely while the join is stale — a median off the last good map is a
  // guess built on a guess, and "unknown" is the honest reading.
  const forecasts = useMemo(
    () => (planSummariesStale ? {} : deskForecasts(notes, summaries)),
    [notes, summaries, planSummariesStale],
  );

  // Selection survives filter and find changes: the same note stays selected
  // while it is still in the set, otherwise the lamp sits on whichever note now
  // occupies its old slot.
  const previousIdsRef = useRef<readonly string[]>([]);
  useEffect(() => {
    if (focusNoteId && visibleIds.includes(focusNoteId)) {
      dispatch({ type: 'select', id: focusNoteId });
    } else {
      dispatch({ type: 'survive', ids: visibleIds, previousIds: previousIdsRef.current });
    }
    previousIdsRef.current = visibleIds;
  }, [visibleIds, focusNoteId]);

  const scrollTo = useCallback(
    (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-desk-id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );

  useEffect(() => {
    if (chrome.selectedId) scrollTo(chrome.selectedId);
    else setPendingReview(false);
  }, [chrome.selectedId, visibleKey, scrollTo]);

  const pickStatus = useCallback((next: DeskFilter) => {
    setStatus(next);
    writeDeskFilter(next);
  }, []);

  const submitCapture = () => {
    const text = capture.trim();
    if (!text || atCap) return;
    onCreate({ bodyMd: text, projectId: active === PROJECT_ALL || active === PROJECT_NONE ? null : active });
    setCapture('');
  };

  const onAct = useCallback((id: string, action: CardAction) => {
    commandSeq.current += 1;
    setCommand({ seq: commandSeq.current, noteId: id, kind: action });
  }, []);

  const onPendingReview = useCallback((pending: boolean) => {
    setPendingReview(pending);
  }, []);

  const columns = useGridColumns(gridRef, `${visible.length > 0}|${visibleKey}`);

  useDeskKeyboard({
    enabled: !loading,
    chrome,
    dispatch,
    visibleIds,
    columns,
    statusFilters: DESK_FILTERS,
    status,
    onStatus: pickStatus,
    projectIds: tabs.map((tab) => tab.id),
    project: active,
    onProject: setFilter,
    onOpen,
    onAct,
    searchRef,
    scrollTo,
  });

  const selectedNote = visible.find((n) => n.id === chrome.selectedId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="notepad-overview">
      <div className="px-8 pt-6 flex flex-col gap-5 min-h-full">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="typo-heading-lg text-foreground">{t.notepad.tabs_label}</h2>
            <span className="typo-caption text-foreground/85">
              {tx(t.notepad.overview_count, { count: slotCount, cap: NOTE_CAP })}
              {chrome.query.trim() ? ` · ${tx(t.notepad.desk_matching, { count: visible.length })}` : ''}
            </span>
          </div>
          <Tooltip content={t.notepad.desk_keys_title}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'toggleCheat' })}
              aria-label={t.notepad.desk_keys_title}
              data-testid="notepad-desk-help"
              className="shrink-0 h-8 px-2 rounded-interactive flex items-center gap-1.5 text-foreground/85 hover:bg-secondary/50 focus-ring"
            >
              <Keycap>{DESK_KEY.help}</Keycap>
              <span className="typo-caption">{t.notepad.desk_hint_keys}</span>
            </button>
          </Tooltip>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCapture();
          }}
          className="flex items-center gap-2 px-4 rounded-card border border-primary/15 bg-secondary/15 focus-within:border-primary/35 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-primary/70 shrink-0" aria-hidden />
          <input
            type="text"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            disabled={atCap}
            placeholder={atCap ? tx(t.notepad.cap_reached, { count: slotCount }) : t.notepad.overview_capture_placeholder}
            aria-label={t.notepad.overview_capture_placeholder}
            data-testid="notepad-overview-capture"
            className="flex-1 min-w-0 h-12 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/60 outline-none disabled:is-disabled"
          />
          <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 text-foreground/85">
            <Keycap>{DESK_KEY.enter}</Keycap>
            <CornerDownLeft className="w-4 h-4 opacity-40" aria-hidden />
          </span>
        </form>

        <AnimatePresence initial={false}>
          {chrome.searchOpen && (
            <motion.div
              key="find"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, y: -6 }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
              className="overflow-hidden"
            >
              <label className="flex items-center gap-2 px-4 rounded-card border border-primary/30 bg-primary/10 focus-within:border-primary/50">
                <Search className="w-4 h-4 text-primary shrink-0" aria-hidden />
                <input
                  ref={searchRef}
                  type="text"
                  value={chrome.query}
                  onChange={(e) => dispatch({ type: 'setQuery', query: e.target.value })}
                  placeholder={t.notepad.desk_search_placeholder}
                  aria-label={t.notepad.desk_search_label}
                  data-testid="notepad-desk-search"
                  className="flex-1 min-w-0 h-11 bg-transparent typo-body text-foreground placeholder:text-foreground/60 outline-none"
                />
                <Keycap>{DESK_KEY.find}</Keycap>
              </label>
            </motion.div>
          )}
        </AnimatePresence>

        {!loading && (
          <div className="flex items-center gap-3 flex-wrap">
            <SegmentedTabs
              tabs={statusTabs}
              activeTab={status}
              onTabChange={pickStatus}
              size="sm"
              fullWidth={false}
              ariaLabel={t.notepad.desk_filter_label}
              layoutId="notepad-desk-status"
              idPrefix="notepad-desk-status"
            />
            {tabs.length > 2 && (
              <SegmentedTabs
                tabs={tabs}
                activeTab={active}
                onTabChange={setFilter}
                size="sm"
                fullWidth={false}
                ariaLabel={t.notepad.project_label}
                layoutId="notepad-desk-filter"
                idPrefix="notepad-desk-filter"
              />
            )}
          </div>
        )}

        {loading ? (
          <OverviewGhost />
        ) : (
          <LayoutGroup id="notepad-desk">
            <div
              className="relative rounded-card border border-primary/10 bg-secondary/10 p-4 flex-1"
              role="tabpanel"
              id={`notepad-desk-filter-panel-${active}`}
              aria-labelledby={`notepad-desk-filter-tab-${active}`}
              aria-activedescendant={chrome.selectedId ? `notepad-desk-card-${chrome.selectedId}` : undefined}
            >
              {visible.length === 0 ? (
                <div className="py-16 flex flex-col items-center gap-1 text-center">
                  <p className="typo-title">
                    {chrome.query.trim() ? t.notepad.desk_no_matches : t.notepad.empty_title}
                  </p>
                  <p className="typo-caption text-foreground/85">
                    {chrome.query.trim() ? t.notepad.desk_no_matches_hint : t.notepad.empty_subtitle}
                  </p>
                </div>
              ) : (
                <div ref={gridRef} className="grid grid-cols-4 gap-4" data-testid="notepad-desk-grid">
                  {/* THE GRID MOVES, it does not jump. Each card sits in a `layout`
                      wrapper under `AnimatePresence`, so a filter change or a delete
                      slides the survivors into place and fades the leavers out.
                      The wrapper is deliberately OUTSIDE `RevealItem`: the entrance
                      cascade is a one-shot CSS animation on the card, and layout is
                      a transform on its parent — nesting them keeps the two from
                      fighting over the same element's `transform`. */}
                  <AnimatePresence initial={false} mode="popLayout">
                    {visible.map((note, index) => (
                      <motion.div
                        key={note.id}
                        layout={!reduced}
                        initial={!reduced && enter.hasEntered(note.id) ? { opacity: 0, scale: 0.96 } : false}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
                        data-testid={`notepad-card-slot-${note.id}`}
                      >
                        <NoteDeskCard
                          note={note}
                          projects={projects}
                          saveState={saveStates[note.id] ?? 'clean'}
                          summary={summaries[note.id]}
                          forecast={forecasts[note.id]}
                          working={working[note.id]}
                          order={index}
                          reveal={enter}
                          autoFocus={note.id === focusNoteId}
                          selected={note.id === chrome.selectedId}
                          query={chrome.query}
                          command={command?.noteId === note.id ? command : null}
                          onSelect={() => dispatch({ type: 'select', id: note.id })}
                          onPendingReview={note.id === chrome.selectedId ? onPendingReview : undefined}
                          onOpen={() => onOpen(note.id)}
                          onPatch={(patch) => onPatch(note.id, patch)}
                          onDelete={() => onDelete(note)}
                          onCertify={() => onCertify(note.id)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </LayoutGroup>
        )}

        <DeskHintRail
          note={selectedNote}
          pendingReview={pendingReview}
          onFind={() => {
            dispatch({ type: 'openSearch' });
            queueMicrotask(() => searchRef.current?.focus());
          }}
          onHelp={() => dispatch({ type: 'toggleCheat' })}
        />
      </div>

      <DeskCheatSheet open={chrome.cheatOpen} onClose={() => dispatch({ type: 'closeCheat' })} />
    </div>
  );
}
