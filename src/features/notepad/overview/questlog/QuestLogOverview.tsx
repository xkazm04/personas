import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, Sparkles } from 'lucide-react';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import { NOTE_CAP } from '../../notepadStore';
import { noteOccupiesSlot } from '../../noteStatusMeta';
import { useNotepadPlanSummaries } from '../../useNotepad';
import { useNoteUnreadMap } from '../../thread/noteThreadStore';
import { useNotesWorkingMap } from '../../thread/useNoteWorking';
import { DESK_FILTERS, matchesDeskFilter, readDeskFilter, writeDeskFilter, type DeskFilter } from '../deskFilter';
import { isTypingSurface, matchesQuery, overlayOwnsKeys } from '../deskModel';
import { DeskCheatSheet } from '../parts/DeskCheatSheet';
import { DESK_KEY, Keycap } from '../parts/Keycap';
import { OverviewGhost } from '../parts/NoteCardBits';
import type { NoteOverviewProps } from '../types';
import { QuestBelow } from './QuestBelow';
import { QuestZone } from './QuestZone';
import type { GoalSignals } from './QuestRow';
import { buildZones, isLate, lateDays, moveZone, stepZone } from './questlogModel';
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
  loading, notes, projects, atCap, focusNoteId, initialProjectId, onOpen, onCreate,
}: NoteOverviewProps & { loading: boolean }) {
  const { t, tx } = useTranslation();
  const working = useNotesWorkingMap();
  const unread = useNoteUnreadMap();
  const summaries = useNotepadPlanSummaries();

  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [rail, setRail] = useState<DeskFilter>(readDeskFilter);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [capture, setCapture] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(initialProjectId ?? null);
  const [goalId, setGoalId] = useState<string | null>(focusNoteId);

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

  const signature = useMemo(
    () => `${rail}|${query.trim() ? '1' : '0'}|${zones.map((z) => `${z.id}:${z.goals.length}`).join(',')}`,
    [rail, query, zones],
  );
  const layout = useQuestLayout(rootRef, zones.length, signature);
  const placeCaret = useQuestCaret(rootRef, caretRef, currentZoneId);

  const [columnEls, setColumnEls] = useState<(HTMLElement | null)[]>([]);
  const setColumnRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    setColumnEls((prev) => (prev[index] === el ? prev : Object.assign([...prev], { [index]: el })));
  }, []);

  useEffect(() => { placeCaret(); }, [placeCaret, layout, signature]);

  const slotCount = useMemo(() => notes.filter((n) => noteOccupiesSlot(n.status)).length, [notes]);
  const railPanel = segmentedTabPanelProps(RAIL_PREFIX, rail);

  const pickRail = useCallback((next: DeskFilter) => {
    setRail(next);
    writeDeskFilter(next);
  }, []);

  const openGoal = useCallback((id: string) => { setGoalId(id); onOpen(id); }, [onOpen]);

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
    const step = (dx: -1 | 0 | 1, dy: -1 | 0 | 1): boolean => {
      const next = moveZone(layout.groups, currentIndex, dx, dy);
      if (next === null || !zoneIds[next]) return false;
      setZoneId(zoneIds[next]!);
      return true;
    };
    if (k === '?') { setCheatOpen((v) => !v); return true; }
    if (k === '/') { setSearchOpen(true); queueMicrotask(() => searchRef.current?.focus()); return true; }
    if (k === 'Escape') {
      // The desk's own Escape ladder, in the order the operator built the state.
      if (cheatOpen) { setCheatOpen(false); return true; }
      if (query) { setQuery(''); return true; }
      if (searchOpen) { setSearchOpen(false); return true; }
      return; // nothing of ours is open — let the pad's layer ladder have it
    }
    if (k === '1' || k === '2' || k === '3') { pickRail(DESK_FILTERS[Number(k) - 1]!); return true; }
    if (k === '[' || k === ']') {
      const next = stepZone(zoneIds, currentZoneId, k === '[' ? -1 : 1);
      if (!next) return false;
      setZoneId(next);
      return true;
    }
    if (k === 'ArrowUp' || k === 'k') return step(0, -1);
    if (k === 'ArrowDown' || k === 'j') return step(0, 1);
    if (k === 'ArrowLeft' || k === 'h') return step(-1, 0);
    if (k === 'ArrowRight' || k === 'l') return step(1, 0);
    if (k === 'Enter') {
      const zone = zones[currentIndex];
      const target = goalId && zone?.goals.some((n) => n.id === goalId)
        ? goalId
        : zone?.goals.find((n) => n.status !== 'shipped')?.id;
      if (!target) return false;
      openGoal(target);
      return true;
    }
  }, [layout.groups, currentIndex, currentZoneId, zoneIds, zones, goalId, query, searchOpen, cheatOpen, pickRail, openGoal]);

  useAppKeyboard(onKey, { enabled: !loading, priority: QUESTLOG_KEY_PRIORITY });

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
            <button
              type="button"
              onClick={() => setCheatOpen((v) => !v)}
              aria-label={t.notepad.desk_keys_title}
              className="h-8 px-2 rounded-interactive flex items-center gap-1.5 text-foreground/85 hover:bg-secondary/50 focus-ring"
            >
              <Keycap>{DESK_KEY.help}</Keycap>
              <span className="typo-caption">{t.notepad.desk_hint_keys}</span>
            </button>
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
          ref={rootRef}
          className="ql-root flex-1 min-h-0 px-4 pb-2"
          data-testid="notepad-questlog-desk"
          // role declared literally, ids from the primitive so they cannot drift
          // from what SegmentedTabs emits in aria-controls.
          role="tabpanel"
          id={railPanel.id}
          aria-labelledby={railPanel["aria-labelledby"]}
        >
          <span ref={caretRef} className="ql-caret" aria-hidden />
          <div className="ql-cols">
            {layout.groups.map(([start, end], column) => (
              <div
                key={column}
                ref={setColumnRef(column)}
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
                    onFocusZone={() => setZoneId(zone.id)}
                    onSelectGoal={setGoalId}
                    onOpenGoal={openGoal}
                  />
                ))}
                {layout.scrolling && <QuestBelow column={columnEls[column] ?? null} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-8 py-2 flex items-center gap-4 flex-wrap shrink-0 border-t border-primary/10">
        <Hint keycap={DESK_KEY.arrows} label={t.notepad.desk_key_column} />
        <Hint keycap={`${DESK_KEY.bracketOpen} ${DESK_KEY.bracketClose}`} label={t.notepad.desk_key_alphabetical} />
        <Hint keycap={DESK_KEY.enterGlyph} label={t.notepad.overview_open} />
        <Hint keycap={DESK_KEY.find} label={t.notepad.desk_hint_find} />
        <Hint keycap={DESK_KEY.rails} label={t.notepad.desk_hint_rails} />
      </div>

      <DeskCheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />
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
