// PersonaMonitor — the full-screen fleet monitor.
//
// Fleet view is a project overview: a column per team/dev project, each listing
// that team's active goals and the personas needing manual attention (see
// MonitorProjectColumns). A persona-fulltext search narrows the columns; a
// drawer layers over for detail. The Channels view (multi-team timeline) and a
// live-mode pop-up toggle sit in the header. The global fleet pulse lives in
// the app chrome (see FleetActivityStrip), not here.

import { useState, useMemo, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Activity, Search, MessagesSquare, Bell } from 'lucide-react';
import FleetActivityStrip from '@/features/shared/chrome/FleetActivityStrip';
import { useTranslation } from '@/i18n/useTranslation';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { useSystemStore } from '@/stores/systemStore';
import { useIsDarkTheme } from '@/stores/themeStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useMonitorData } from './useMonitorData';
import { MonitorDrawer } from './MonitorDrawer';
import { MonitorChannelGrid } from './channels';
import { MonitorProjectColumns } from './triage/MonitorProjectColumns';
import {
  buildMonitorModel,
  processStatusMeta, processStatusLabel, elapsedStr,
  type ProcessEntry, type DrawerSection,
} from './monitorModel';

interface PersonaMonitorProps {
  onClose: () => void;
}


interface Selection {
  personaId: string;
  section: DrawerSection;
}

export function PersonaMonitor({ onClose }: PersonaMonitorProps) {
  const { t, tx } = useTranslation();
  const {
    personas, healthMap, reviews, unreadMessages, activeProcesses,
    isProcessing, handleReviewAction, handleMarkRead,
  } = useMonitorData();

  const { cards, systemProcesses } = useMemo(
    () => buildMonitorModel(personas, reviews, unreadMessages, activeProcesses, healthMap),
    [personas, reviews, unreadMessages, activeProcesses, healthMap],
  );

  // View mode — the fleet persona grid, or "channel mode" (multiple team
  // channels watched in parallel). A live-mode pop-up can deep-link here via the
  // transient `monitorInitialView` signal, landing straight on the Timeline.
  const monitorInitialView = useSystemStore((s) => s.monitorInitialView);
  const setMonitorInitialView = useSystemStore((s) => s.setMonitorInitialView);
  const [viewMode, setViewMode] = useState<'fleet' | 'channels'>(monitorInitialView ?? 'fleet');
  useEffect(() => {
    if (!monitorInitialView) return;
    setViewMode(monitorInitialView);
    setMonitorInitialView(null);
  }, [monitorInitialView, setMonitorInitialView]);

  // Live-mode pop-ups on/off — surfaced in the header so it's always reachable
  // (the Channels -> Timeline toggle requires teams + navigating in).
  const liveMode = useSystemStore((s) => s.monitorLiveMode);
  const toggleLiveMode = useSystemStore((s) => s.toggleMonitorLiveMode);

  // Persona fulltext search — replaces the old Dev-Tools project filter. The
  // monitor defaults to showing ALL personas; the search narrows the grid by
  // persona name, debounced for a smooth typing experience.
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200).trim().toLowerCase();
  const displayCards = useMemo(
    () =>
      debouncedSearch
        ? cards.filter((c) => c.personaName.toLowerCase().includes(debouncedSearch))
        : cards,
    [cards, debouncedSearch],
  );

  // Teams power the project columns + the Channels view.
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  // Tick once a second only while something is running.
  const anyRunning = useMemo(
    () => Object.values(activeProcesses).some((p) => p.status === 'running'),
    [activeProcesses],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Only fleet view reads `now` (elapsed-time on cards + SystemBand). In
    // channel view nothing consumes it, so ticking there would re-render the
    // whole channel workspace once a second for nothing — gate it out.
    if (!anyRunning || viewMode !== 'fleet') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning, viewMode]);

  const [selection, setSelection] = useState<Selection | null>(null);
  // Stable open handler (takes personaId) so the memoized column rows don't
  // re-render just because an inline onSelect closure changed identity.
  const handleCardSelect = useCallback(
    (personaId: string, section: DrawerSection) => setSelection({ personaId, section }),
    [],
  );
  const selectedCard = useMemo(
    () => cards.find((c) => c.personaId === selection?.personaId) ?? null,
    [cards, selection],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selection) setSelection(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, onClose]);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selection?.personaId) ?? null,
    [personas, selection],
  );

  // Faint network-of-agents backdrop — dark mode only (the light-theme
  // alternative is a follow-up). Rendered behind everything at low opacity so
  // it reads as premium texture, not a competing foreground.
  const isDark = useIsDarkTheme();

  // The overlay is fully opaque (was bg-background/98 + backdrop-blur-xl): the
  // blur was invisible at 98% opacity but forced the GPU to re-composite the
  // whole app underneath every frame. A full-screen opaque overlay that
  // occludes the layers below lets the browser skip painting them entirely.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 bg-background flex flex-col"
      data-testid="persona-monitor"
    >
      {/* Faint interconnected-agents backdrop (dark mode only). */}
      {isDark && (
        <img
          aria-hidden
          src="/illustrations/monitor-network-dark.png"
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover opacity-[0.07]"
        />
      )}

      {/* Header (z-20 so the project-picker dropdown floats above the grid) */}
      <div className="relative z-20 flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="typo-heading-lg text-foreground leading-tight">{t.monitor.title}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'fleet' && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.monitor.search_personas_placeholder}
                className="w-44 pl-8 pr-7 py-1 rounded-full bg-secondary/20 border border-primary/15 typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40 transition-colors"
                data-testid="monitor-persona-search"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground hover:text-foreground/80 transition-colors"
                  aria-label={t.monitor.clear_filter}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          {/* Channels → Timeline: the 3-zone all-team channel workspace (team
              filter · merged stream · Quick Answer). Always reachable so the
              entry never disappears when no teams are loaded. */}
          <button
            type="button"
            onClick={() => setViewMode((v) => (v === 'channels' ? 'fleet' : 'channels'))}
            aria-pressed={viewMode === 'channels'}
            title={t.monitor.channels_mode_title}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-body-lg transition-colors ${
              viewMode === 'channels'
                ? 'border-status-error/40 bg-status-error/15 text-status-error'
                : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
            }`}
          >
            <MessagesSquare className="w-3 h-3" />
            {t.monitor.channels_mode}
          </button>
          {/* Live-mode pop-ups on/off — always reachable here. */}
          <button
            type="button"
            onClick={toggleLiveMode}
            aria-pressed={liveMode}
            title={t.monitor.live_toggle_hint}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-body-lg transition-colors ${
              liveMode
                ? 'border-status-success/40 bg-status-success/15 text-status-success'
                : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
            }`}
          >
            <Bell className="w-3 h-3" />
            {t.monitor.live_toggle}
          </button>
          <button
            onClick={onClose}
            className="ml-1 p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
            aria-label={t.monitor.close}
            title={t.monitor.close_hint}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live fleet pulse — the same executions bar shown under the titlebar
          (reused), so running/queued executions are visible right in the header
          instead of static count badges. */}
      <div className="relative flex-shrink-0 h-2.5 border-b border-primary/10">
        <FleetActivityStrip />
      </div>

      {/* System band — app-level activity with no persona (fleet view only) */}
      {viewMode === 'fleet' && <SystemBand processes={systemProcesses} now={now} />}

      {/* Channel mode — multiple team channels in parallel */}
      {viewMode === 'channels' ? (
        <div className="relative z-10 flex-1 min-h-0">
          <MonitorChannelGrid teams={teams} personas={personas} />
        </div>
      ) : (
      /* Body — project columns overview with the drawer layered over it */
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden px-5 py-4">
          <MonitorProjectColumns
            cards={displayCards}
            personas={personas}
            teams={teams}
            selectedPersonaId={selection?.personaId ?? null}
            onSelect={handleCardSelect}
          />
        </div>

        <AnimatePresence>
          {selectedCard && selection && (
            <>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setSelection(null)}
                className="absolute inset-0 z-10 bg-background/55 backdrop-blur-sm"
              />
              <motion.div
                key="drawer"
                initial={{ y: '-100%' }}
                animate={{ y: 0 }}
                exit={{ y: '-100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 34 }}
                className="absolute inset-x-0 top-0 z-20 max-h-full flex flex-col rounded-b-modal border-b border-x border-primary/15 bg-background shadow-elevation-4"
              >
                <MonitorDrawer
                  card={selectedCard}
                  initialSection={selection.section}
                  designContext={selectedPersona?.design_context ?? null}
                  isProcessing={isProcessing}
                  now={now}
                  onReviewAction={(id, status, notes) => void handleReviewAction(id, status, notes)}
                  onMarkRead={(id) => void handleMarkRead(id)}
                  onClose={() => setSelection(null)}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      )}

      {/* Footer hint */}
      <div className="relative z-10 flex-shrink-0 h-9 px-6 flex items-center justify-between border-t border-primary/8 bg-secondary/10 typo-caption text-foreground">
        <span>{t.monitor.footer_legend}</span>
        <span>{tx(t.monitor.footer_counts, { reviews: reviews.length, system: systemProcesses.length })}</span>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// System band
// ---------------------------------------------------------------------------

function SystemBand({ processes, now }: { processes: ProcessEntry[]; now: number }) {
  const { t } = useTranslation();
  if (processes.length === 0) return null;
  return (
    <div className="relative z-10 flex-shrink-0 flex items-center gap-2 px-5 py-2 border-b border-primary/8 bg-secondary/12 overflow-x-auto">
      <span className="flex-shrink-0 flex items-center gap-1.5 typo-caption uppercase tracking-wider text-foreground">
        <Activity className="w-3 h-3" /> {t.monitor.system}
      </span>
      {processes.map(({ key, proc }) => {
        const M = processStatusMeta(proc.status);
        return (
          <span
            key={key}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/12 bg-background/60 typo-caption"
            title={proc.lastEvent ?? proc.domain}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${M.dot} ${M.pulse ? 'animate-pulse' : ''}`} />
            <span className="text-foreground max-w-[160px] truncate">{proc.label ?? proc.domain}</span>
            <span className={M.text}>
              {proc.status === 'running' ? elapsedStr(proc.startedAt, now) : processStatusLabel(t, proc.status)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default PersonaMonitor;
