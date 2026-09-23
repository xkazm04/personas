import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, Sparkles } from 'lucide-react';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import { NOTE_CAP } from '../../notepadStore';
import { noteOccupiesSlot } from '../../noteStatusMeta';
import { useNotepadPlanSummaries, useNotepadStatus } from '../../useNotepad';
import { useNoteUnreadMap } from '../../thread/noteThreadStore';
import { useNotesWorkingMap } from '../../thread/useNoteWorking';
import { DESK_FILTERS, matchesDeskFilter, readDeskFilter, writeDeskFilter, type DeskFilter } from '../deskFilter';
import { isTypingSurface, matchesQuery, overlayOwnsKeys } from '../deskModel';
import { DESK_KEY, Keycap } from '../parts/Keycap';
import { OverviewGhost } from '../parts/NoteCardBits';
import type { NoteOverviewProps } from '../types';
import { archiveNote } from '../../notepadStore';
import { publishFleet, toGoals } from '../../notepadActions';
import { NoteAskQuickInput, NoteCardMenu } from '../parts/NoteCardMenu';
import { deskForecasts } from '../deskForecast';
import type { RailNext } from '../parts/NoteLifecycleRail';
import { QuestBelow } from './QuestBelow';
import { QuestRoom } from './QuestRoom';
import { QuestZone } from './QuestZone';
import type { GoalSignals, RowDetail } from './QuestRow';
import {
  buildZones, cursorColumns, firstGoalOf, isLate, lateDays, moveGoal, stepZone,
} from './questlogModel';
import { useQuestCaret, useQuestLayout } from './useQuestLayout';
import './questlog.css';

const FILTER_LABEL: Record<DeskFilter, (t: Translations) => string> = {
  drafts: (t) => t.notepad.desk_filter_drafts,
  scoped: (t) => t.notepad.desk_filter_scoped,
  all: (t) => t.common.all,
};
const RAIL_KEYS = [DESK_KEY.rail1, DESK_KEY.rail2, DESK_KEY.rail3] as const;
const RAIL_PREFIX = 'notepad-questlog-rail';

/** One above the pad's own layer, exactly as the card desk registers: the pad
 *  owns the Escape ladder, and the desk gets first refusal on everything else. */
const QUESTLOG_KEY_PRIORITY = NOTEPAD_LAYER_PRIORITY + 1;

/**
 * The journal desk — every project in a fixed alphabetical seat, one goal per
 * line, the rail filter as a lens rather than a cut.
 *
 * It exists because the card desk does not scale. Measured on a staged 90 goals
 * across 16 projects: the four-column grid runs twenty-three rows deep, and the
 * treemap that replaced it moved sixteen of seventeen groups on every filter
 * change, so no position could ever be learned. Here a project's seat is derived
 * from its NAME and nothing else, so it never moves; the rail dims what is off
 * it instead of removing it; and a run of one status collapses to a single glyph
 * and a wire, so eleven scoped goals read as one bracket.
 *
 * Same props as the card desk (`NoteOverviewProps`), so the host owns the state
 * and this file owns only the layout.
 */
export function QuestLogOverview({
  loading, notes, projects, saveStates, atCap, focusNoteId, initialProjectId,
  onOpen, onPatch, onCreate, onDelete, onCertify,
}: NoteOverviewProps & { loading: boolean }) {
  const { t, tx } = useTranslation();
  const working = useNotesWorkingMap();
  const unread = useNoteUnreadMap();
  const summaries = useNotepadPlanSummaries();
  const { planSummariesStale } = useNotepadStatus();

  // ELEMENTS, not refs. This desk renders only after the pad stops loading, so
  // a ref object read by an effect that depends on the ref (which never changes)
  // is read once, while it is still null, and never looked at again.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [caretEl, setCaretEl] = useState<HTMLSpanElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [rail, setRail] = useState<DeskFilter>(readDeskFilter);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  /** Right-click position for the quick-action menu, and for the Ask field it
   *  opens — both portaled, both the card's own components. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ask, setAsk] = useState<{ id: string; x: number; y: number } | null>(null);
  const [capture, setCapture] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(initialProjectId ?? null);
  const [goalId, setGoalId] = useState<string | null>(focusNoteId);
  /** The project whose interlayer is open, or null for the desk. */
  const [roomId, setRoomId] = useState<string | null>(null);
  /** The selected goal's second row is open. One at a time, by construction. */
  const [expanded, setExpanded] = useState(false);

  // Every signal a row can carry, assembled once for the whole desk. A row
  // never reaches into a store: ninety rows each holding their own
  // subscription is how a desk starts dropping frames.
  const signals = useMemo(() => {
    const out: Record<string, GoalSignals> = {};
    for (const note of notes) {
      const target = summaries[note.id]?.targetDate ?? null;
      out[note.id] = {
        unread: unread[note.id] ?? 0,
        workingSince: working[note.id]?.since ?? null,
        lateDays: isLate(target, note.status) ? lateDays(target!) : 0,
        onRail: matchesDeskFilter(note.status, rail),
      };
    }
    return out;
  }, [notes, unread, working, summaries, rail]);

  const zones = useMemo(
    () => buildZones(notes, projects, t.notepad.project_none),
    [notes, projects, t],
  );
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const matches = useMemo(() => {
    const set = new Set<string>();
    if (!query.trim()) return set;
    for (const note of notes) if (matchesQuery(query, note.title, note.bodyMd)) set.add(note.id);
    return set;
  }, [notes, query]);

  // A zone can outlive its last goal (archived, re-mapped) — fall back to the first.
  const currentZoneId = zoneId && zoneIds.includes(zoneId) ? zoneId : zoneIds[0] ?? null;
  const currentIndex = currentZoneId ? zoneIds.indexOf(currentZoneId) : -1;
  const isOnRail = useCallback((id: string) => signals[id]?.onRail ?? true, [signals]);

  const signature = useMemo(
    () => `${rail}|${query.trim() ? '1' : '0'}|${zones.map((z) => `${z.id}:${z.goals.length}`).join(',')}`,
    [rail, query, zones],
  );
  const layout = useQuestLayout(rootEl, zones.length, signature);
  // The goals the arrows may land on, per column, in reading order.
  const cursorCols = useMemo(
    () => cursorColumns(zones, layout.groups, isOnRail),
    [zones, layout.groups, isOnRail],
  );
  // Suppressed entirely while the plan join is stale: a median taken off the
  // last good map is a guess built on a guess, and "unknown" is the honest
  // reading. The card desk guarded this and the first port of the journal did
  // not — restored 2026-09-23.
  const forecasts = useMemo(
    () => (planSummariesStale ? {} : deskForecasts(notes, summaries)),
    [notes, summaries, planSummariesStale],
  );
  const roomZone = roomId ? zones.find((z) => z.id === roomId) ?? null : null;
  const placeCaret = useQuestCaret(rootEl, caretEl, currentZoneId);

  useEffect(() => { placeCaret(); }, [placeCaret, layout, signature]);

  // Park the cursor on a real goal as soon as there is one, and re-park it when
  // the rail filter takes the current goal away. Without this the desk opens
  // with nothing selected, so "x" and Enter do nothing until an arrow is
  // pressed - and both keys are advertised in the hint rail, so they have to
  // work the moment the desk is on screen.
  useEffect(() => {
    const flat = cursorCols.flat();
    if (flat.length === 0) return;
    if (goalId && flat.includes(goalId)) return;
    const first = (currentZoneId && firstGoalOf(zones.find((z) => z.id === currentZoneId), isOnRail)) || flat[0]!;
    setGoalId(first);
  }, [cursorCols, goalId, currentZoneId, zones, isOnRail]);

  const slotCount = useMemo(() => notes.filter((n) => noteOccupiesSlot(n.status)).length, [notes]);
  const railPanel = segmentedTabPanelProps(RAIL_PREFIX, rail);

  const pickRail = useCallback((next: DeskFilter) => {
    setRail(next);
    writeDeskFilter(next);
  }, []);

  const openGoal = useCallback((id: string) => { setGoalId(id); onOpen(id); }, [onOpen]);

  /** Open a project's interlayer, and put the cursor on its first live goal so
   *  leaving the room returns to something sensible. */
  const openRoom = useCallback((id: string) => {
    setZoneId(id);
    const first = firstGoalOf(zones.find((z) => z.id === id), isOnRail);
    if (first) setGoalId(first);
    setRoomId(id);
  }, [zones, isOnRail]);

  /** Walk to the neighbouring project, taking the cursor and (when it is up)
   *  the interlayer with it. Shared by the desk's `[`/`]` and the room's. */
  const stepProject = useCallback((delta: 1 | -1) => {
    const next = stepZone(zoneIds, currentZoneId, delta);
    if (!next) return;
    setZoneId(next);
    const first = firstGoalOf(zones.find((z) => z.id === next), isOnRail);
    if (first) setGoalId(first);
    setRoomId((open) => (open ? next : open));
  }, [zoneIds, currentZoneId, zones, isOnRail]);

  /** The lifecycle rail's one move, wired exactly as the card wires it. */
  const advance = useCallback(async (note: typeof notes[number], next: RailNext) => {
    const project = projects.find((p) => p.id === note.projectId) ?? null;
    if (next.action === 'publish') { await publishFleet(note, project); return; }
    if (next.action === 'goals') { await toGoals(note, project); return; }
    onCertify(note.id);
  }, [projects, onCertify]);

  /** The second row, for the selected goal only, and only while expanded. */
  const detailFor = useCallback((id: string): RowDetail | undefined => {
    if (!expanded || id !== goalId) return undefined;
    const note = notes.find((n) => n.id === id);
    if (!note) return undefined;
    return {
      summary: summaries[id],
      forecast: forecasts[id],
      onAdvance: (next: RailNext) => advance(note, next),
    };
  }, [expanded, goalId, notes, summaries, forecasts, advance]);

  const submitCapture = () => {
    const text = capture.trim();
    if (!text || atCap) return;
    onCreate({ bodyMd: text, projectId: currentZoneId && !zones[currentIndex]?.none ? currentZoneId : null });
    setCapture('');
  };

  // Through the app's ONE keyboard registry, at the same priority the card desk
  // registers at — never a bare `document.addEventListener`, which cannot see
  // the layer ladder and would keep firing under a modal.
  const onKey = useCallback((e: KeyboardEvent): boolean | void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingSurface(e.target) || overlayOwnsKeys(e.target)) {
      if (e.key === 'Escape' && e.target === searchRef.current) {
        setQuery(''); setSearchOpen(false); searchRef.current?.blur();
        return true;
      }
      return;
    }
    const k = e.key;
    // Arrows walk GOALS, not projects, and the list they walk already excludes
    // everything the rail filtered away — so a filtered goal is never stepped
    // onto even though it is still visible, dimmed, in place.
    const step = (dx: -1 | 0 | 1, dy: -1 | 0 | 1): boolean => {
      const next = moveGoal(cursorCols, goalId, dx, dy);
      if (!next) return false;
      setGoalId(next);
      const owner = zones.find((z) => z.goals.some((n) => n.id === next));
      if (owner) setZoneId(owner.id);
      return true;
    };
    if (k === '/') { setSearchOpen(true); queueMicrotask(() => searchRef.current?.focus()); return true; }
    if (k === 'Escape') {
      // The desk's own Escape ladder, in the order the operator built the state.
      if (menu || ask) { setMenu(null); setAsk(null); return true; }
      if (query) { setQuery(''); return true; }
      if (searchOpen) { setSearchOpen(false); return true; }
      return; // nothing of ours is open — let the pad's layer ladder have it
    }
    if (k === '1' || k === '2' || k === '3') { pickRail(DESK_FILTERS[Number(k) - 1]!); return true; }
    if (k === '[' || k === ']') { stepProject(k === '[' ? -1 : 1); return true; }
    if (k === 'x') { setExpanded((v) => !v); return true; }
    if (k === ' ') {
      // The project, not the goal: Space raises the interlayer.
      if (!currentZoneId) return false;
      openRoom(currentZoneId);
      return true;
    }
    if (k === 'ArrowUp' || k === 'k') return step(0, -1);
    if (k === 'ArrowDown' || k === 'j') return step(0, 1);
    if (k === 'ArrowLeft' || k === 'h') return step(-1, 0);
    if (k === 'ArrowRight' || k === 'l') return step(1, 0);
    if (k === 'Enter') {
      // The goal, straight into the editor.
      const target = goalId ?? firstGoalOf(zones[currentIndex], isOnRail);
      if (!target) return false;
      openGoal(target);
      return true;
    }
  }, [cursorCols, currentIndex, currentZoneId, zones, goalId, isOnRail,
      query, searchOpen, menu, ask, pickRail, openGoal, openRoom, stepProject]);

  // The room owns the keyboard while it is up: its cards carry the desk's verbs
  // already, and two handlers claiming the same arrows is how a surface starts
  // moving two cursors at once.
  useAppKeyboard(onKey, { enabled: !loading && !roomId, priority: QUESTLOG_KEY_PRIORITY });

  const railTabs = useMemo(
    () => DESK_FILTERS.map((id, i) => ({
      id,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Keycap>{RAIL_KEYS[i]}</Keycap>
          {FILTER_LABEL[id](t)}
        </span>
      ),
    })),
    [t],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="notepad-questlog">
      {roomZone ? (
        <QuestRoom
          zone={roomZone}
          index={zoneIds.indexOf(roomZone.id)}
          total={zones.length}
          projects={projects}
          saveStates={saveStates}
          signals={signals}
          summaries={summaries}
          working={working}
          selectedGoalId={goalId}
          onSelectGoal={setGoalId}
          onStepProject={stepProject}
          onClose={() => setRoomId(null)}
          onOpen={onOpen}
          onPatch={onPatch}
          onDelete={onDelete}
          onCertify={onCertify}
        />
      ) : (
      <>
      <div className="px-8 pt-5 pb-3 flex flex-col gap-3 shrink-0">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3 min-w-0">
            <h2 className="typo-heading-lg text-foreground">{t.notepad.tabs_label}</h2>
            <span className="typo-caption text-foreground/85">
              {tx(t.notepad.overview_count, { count: slotCount, cap: NOTE_CAP })}
              {query.trim() ? ` · ${tx(t.notepad.desk_matching, { count: matches.size })}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SegmentedTabs
              tabs={railTabs}
              activeTab={rail}
              onTabChange={pickRail}
              size="sm"
              fullWidth={false}
              ariaLabel={t.notepad.desk_filter_label}
              layoutId={RAIL_PREFIX}
              idPrefix={RAIL_PREFIX}
            />
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submitCapture(); }}
          className="flex items-center gap-2 px-3 rounded-input border border-primary/15 bg-secondary/15 focus-within:border-primary/35 transition-colors"
        >
          {searchOpen ? <Search className="w-4 h-4 text-primary shrink-0" aria-hidden />
            : <Sparkles className="w-4 h-4 text-primary/70 shrink-0" aria-hidden />}
          {searchOpen ? (
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.notepad.desk_search_placeholder}
              aria-label={t.notepad.desk_search_label}
              data-testid="notepad-questlog-search"
              className="flex-1 min-w-0 h-10 bg-transparent typo-body text-foreground placeholder:text-foreground/85 outline-none"
            />
          ) : (
            <input
              type="text"
              value={capture}
              onChange={(e) => setCapture(e.target.value)}
              disabled={atCap}
              placeholder={atCap ? tx(t.notepad.cap_reached, { count: slotCount }) : t.notepad.overview_capture_placeholder}
              aria-label={t.notepad.overview_capture_placeholder}
              data-testid="notepad-questlog-capture"
              className="flex-1 min-w-0 h-10 bg-transparent typo-body text-foreground placeholder:text-foreground/85 outline-none disabled:is-disabled"
            />
          )}
          <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 text-foreground/85">
            <Keycap>{searchOpen ? DESK_KEY.find : DESK_KEY.enter}</Keycap>
            {!searchOpen && <CornerDownLeft className="w-4 h-4 opacity-40" aria-hidden />}
          </span>
        </form>
      </div>

      {loading ? (
        <div className="px-8 pb-6"><OverviewGhost /></div>
      ) : zones.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-center px-8">
          <p className="typo-title text-foreground">{t.notepad.empty_title}</p>
          <p className="typo-caption text-foreground/85">{t.notepad.empty_subtitle}</p>
        </div>
      ) : (
        <div
          ref={setRootEl}
          className="ql-root flex-1 min-h-0 px-4 pb-2"
          data-testid="notepad-questlog-desk"
          // role declared literally, ids from the primitive so they cannot drift
          // from what SegmentedTabs emits in aria-controls.
          role="tabpanel"
          id={railPanel.id}
          aria-labelledby={railPanel["aria-labelledby"]}
        >
          <span ref={setCaretEl} className="ql-caret" aria-hidden />
          <div className="ql-cols">
            {layout.groups.map(([start, end], column) => (
              <div
                key={column}
                className={`ql-col${layout.scrolling ? ' is-scrolling' : ''}`}
              >
                {zones.slice(start, end).map((zone) => (
                  <QuestZone
                    key={zone.id}
                    zone={zone}
                    signals={signals}
                    mode={layout.mode}
                    current={zone.id === currentZoneId}
                    selectedGoalId={goalId}
                    query={query}
                    matches={matches}
                    detailFor={detailFor}
                    onContextGoal={(id, e) => {
                      e.preventDefault();
                      setAsk(null);
                      setMenu({ id, x: e.clientX, y: e.clientY });
                    }}
                    onFocusZone={() => openRoom(zone.id)}
                    onSelectGoal={setGoalId}
                    onOpenGoal={openGoal}
                  />
                ))}
                {layout.scrolling && <QuestBelow />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-8 py-2 flex items-center gap-4 flex-wrap shrink-0 border-t border-primary/10">
        <Hint keycap={DESK_KEY.arrows} label={t.notepad.desk_key_column} />
        <Hint keycap={`${DESK_KEY.bracketOpen} ${DESK_KEY.bracketClose}`} label={t.notepad.desk_key_alphabetical} />
        <Hint keycap={DESK_KEY.enterGlyph} label={t.notepad.overview_open} />
        <Hint keycap={DESK_KEY.space} label={t.notepad.desk_key_open_project} />
        <Hint keycap={DESK_KEY.expand} label={t.notepad.desk_key_expand} />
        <Hint keycap={DESK_KEY.find} label={t.notepad.desk_hint_find} />
        <Hint keycap={DESK_KEY.rails} label={t.notepad.desk_hint_rails} />
      </div>
      </>
      )}


      {menu && (() => {
        const note = notes.find((n) => n.id === menu.id);
        if (!note) return null;
        return (
          <NoteCardMenu
            note={note}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            handlers={{
              onOpen: () => openGoal(note.id),
              onAsk: () => setAsk(menu),
              onPublish: () => { void publishFleet(note, projects.find((p) => p.id === note.projectId) ?? null); },
              onToGoals: () => { void toGoals(note, projects.find((p) => p.id === note.projectId) ?? null); },
              onArchive: () => { void archiveNote(note.id); },
              onDelete: () => onDelete(note),
            }}
          />
        );
      })()}
      {ask && (() => {
        const note = notes.find((n) => n.id === ask.id);
        return note ? <NoteAskQuickInput note={note} x={ask.x} y={ask.y} onClose={() => setAsk(null)} /> : null;
      })()}
    </div>
  );
}

function Hint({ keycap, label }: { keycap: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 typo-caption text-foreground/85">
      <Keycap>{keycap}</Keycap>
      {label}
    </span>
  );
}
