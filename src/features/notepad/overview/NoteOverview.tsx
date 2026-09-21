import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { NOTE_CAP } from '../notepadStore';
import { noteOccupiesSlot } from '../noteStatusMeta';
import { useNotepadPlanSummaries, useNotepadStatus } from '../useNotepad';
import { useNotesWorkingMap } from '../thread/useNoteWorking';
import { deskForecasts } from './deskForecast';
import { DESK_FILTERS, matchesDeskFilter, readDeskFilter, writeDeskFilter, type DeskFilter } from './deskFilter';
import { NoteDeskCard } from './NoteDeskCard';
import { OverviewGhost } from './parts/NoteCardBits';
import type { NoteOverviewProps } from './types';

const ALL = '__all';
const NONE = '__none';

/** Resolved against the live translations, never stored as text — the same rule
 *  `noteStatusMeta.labelKey` follows for the status table. */
const FILTER_LABEL: Record<DeskFilter, (t: Translations) => string> = {
  drafts: (t) => t.notepad.desk_filter_drafts,
  scoped: (t) => t.notepad.desk_filter_scoped,
  all: (t) => t.common.all,
};

/**
 * Layer 1 of the pad — the project desk. Every open note as a card; a card
 * opens layer 2, the full editor (`NoteBody` with its tab strip and dispatch
 * bar).
 *
 * A note in this app is thinking ABOUT a repository, so the desk is organised
 * by repository: a filter strip of the projects the notes point at, and a
 * capture line that drops a draft straight into whichever project is selected.
 *
 * TWO filters, because there are two rails: the project one says WHICH
 * repository, the status one says WHICH RAIL (see `deskFilter.ts`). They
 * compose; neither is the other's sub-menu.
 *
 * Picked 2026-09-14 out of three directions a `/prototype` round compared
 * (Index cards, Lifecycle board, Project desk). The other two and the switcher
 * were deleted in the same change.
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
  // Seeded ONCE, from a deep link. `useState`'s initializer rather than an
  // effect: an effect would fight the operator the moment they picked a
  // different project and the prop had not changed.
  const [filter, setFilter] = useState<string>(() => initialProjectId ?? ALL);
  const [status, setStatus] = useState<DeskFilter>(readDeskFilter);
  const [capture, setCapture] = useState('');

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
      { id: ALL, label: `${t.common.all} · ${inRail.length}` },
      ...used.map((p) => ({ id: p.id, label: `${p.name} · ${inRail.filter((n) => n.projectId === p.id).length}` })),
      ...(unmapped > 0 ? [{ id: NONE, label: `${t.notepad.project_none} · ${unmapped}` }] : []),
    ];
  }, [inRail, projects, t]);

  const statusTabs = useMemo(
    () => DESK_FILTERS.map((id) => ({ id, label: FILTER_LABEL[id](t) })),
    [t],
  );

  // A filter can outlive its last note (archived, re-mapped) — fall back to All.
  const active = tabs.some((tab) => tab.id === filter) ? filter : ALL;
  const visible = inRail.filter((n) =>
    active === ALL ? true : active === NONE ? !n.projectId : n.projectId === active,
  );

  // Derived over the WHOLE open set, not the visible slice: a project's cycle
  // evidence does not change because the operator narrowed the desk, and a
  // forecast that moved when you clicked a tab would be a forecast nobody could
  // trust. Suppressed entirely while the join is stale — a median off the last
  // good map is a guess built on a guess, and "unknown" is the honest reading.
  const forecasts = useMemo(
    () => (planSummariesStale ? {} : deskForecasts(notes, summaries)),
    [notes, summaries, planSummariesStale],
  );

  const submitCapture = () => {
    const text = capture.trim();
    if (!text || atCap) return;
    onCreate({ bodyMd: text, projectId: active === ALL || active === NONE ? null : active });
    setCapture('');
  };

  const pickStatus = (next: DeskFilter) => {
    setStatus(next);
    writeDeskFilter(next);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="notepad-overview">
      <div className="px-8 py-6 flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="typo-heading-lg text-foreground">{t.notepad.tabs_label}</h2>
          <span className="typo-caption text-foreground/60">
            {tx(t.notepad.overview_count, { count: slotCount, cap: NOTE_CAP })}
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCapture();
          }}
          className="flex items-center gap-2 px-4 rounded-card border border-primary/15 bg-secondary/15 focus-within:border-primary/35 transition-colors"
        >
          <input
            type="text"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            disabled={atCap}
            placeholder={atCap ? tx(t.notepad.cap_reached, { count: slotCount }) : t.notepad.overview_capture_placeholder}
            aria-label={t.notepad.overview_capture_placeholder}
            data-testid="notepad-overview-capture"
            className="flex-1 min-w-0 h-12 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/50 outline-none disabled:is-disabled"
          />
          <CornerDownLeft className="w-4 h-4 text-foreground opacity-40" aria-hidden />
        </form>

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
          <div className="grid grid-cols-4 gap-4" role="tabpanel" id={`notepad-desk-filter-panel-${active}`} aria-labelledby={`notepad-desk-filter-tab-${active}`}>
            {/* THE GRID MOVES, it does not jump. Each card sits in a `layout`
                wrapper under `AnimatePresence`, so a filter change or a delete
                slides the survivors into place and fades the leavers out.
                The wrapper is deliberately OUTSIDE `RevealItem`: the entrance
                cascade is a one-shot CSS animation on the card, and layout is
                a transform on its parent — nesting them keeps the two from
                fighting over the same element's `transform`. `popLayout` takes
                a leaver out of flow at once, so the reflow starts with the exit
                rather than after it. */}
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((note, index) => (
                <motion.div
                  key={note.id}
                  layout={!reduced}
                  // A card that has never entered gets the RevealItem cascade and
                  // nothing else; only a RE-entry (a filter bringing it back)
                  // fades in here, so no card ever plays two entrances at once.
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
    </div>
  );
}
