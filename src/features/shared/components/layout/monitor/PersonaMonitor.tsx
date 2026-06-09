// PersonaMonitor — the full-screen fleet monitor.
//
// One card per persona, fleet-wide. Each persona card is a "pillar" — a 1px
// state-coloured top strip, a full-width title (2-line clamp) that is also the
// primary open affordance, a state caption with live elapsed/telemetry, a
// recent-run health micro-bar, and the persona icon as a signature mark in the
// bottom-right. Reviews and messages get their own badges. The global fleet
// pulse lives in the app chrome (see FleetActivityStrip), not here.

import { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Activity, Mail, Layers, ChevronDown, Wrench, Search, MessagesSquare } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import FleetActivityStrip from '@/features/shared/components/layout/FleetActivityStrip';
import { useTranslation } from '@/i18n/useTranslation';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { useSystemStore } from '@/stores/systemStore';
import { useIsDarkTheme } from '@/stores/themeStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { useMonitorData } from './useMonitorData';
import { MonitorDrawer } from './MonitorDrawer';
import { MonitorChannelGrid } from './channels';
import {
  buildMonitorModel, SEVERITY_META,
  processStatusMeta, processStatusLabel, elapsedStr,
  pillarVisual, captionDescriptor, primaryDrawerSection, healthSegments, HEALTH_TONE_CLASS,
  type PersonaCardModel, type ProcessEntry, type DrawerSection,
  type CaptionDescriptor,
} from './monitorModel';

/** How many recent-run outcomes the card health micro-bar shows. */
const HEALTH_BAR_LENGTH = 7;

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
  // channels watched in parallel).
  const [viewMode, setViewMode] = useState<'fleet' | 'channels'>('fleet');

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

  // Group-by toggle — when enabled, partition cards by their persona's
  // home_team_id (workspace) and render each team under a collapsible
  // header. State is persisted in systemStore (cycle 8 promotion) so
  // re-opening the Monitor preserves the user's last view across the
  // session and across restarts.
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const groupBy = useSystemStore((s) => s.monitorGroupBy);
  const setGroupBy = useSystemStore((s) => s.setMonitorGroupBy);
  const collapsedGroupsArr = useSystemStore((s) => s.monitorCollapsedGroups);
  const toggleMonitorGroupCollapsed = useSystemStore((s) => s.toggleMonitorGroupCollapsed);
  // Local memo: arr → Set for O(1) lookup in render. Recomputes only when
  // the persisted array identity changes (i.e. user toggled).
  const collapsedGroups = useMemo(() => new Set(collapsedGroupsArr), [collapsedGroupsArr]);

  // Load teams once so the group-by toggle has workspace metadata to render.
  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  const groupedDisplay = useMemo(() => {
    if (groupBy === 'none') return null;
    const byGroup = new Map<string, PersonaCardModel[]>();
    const ungrouped: PersonaCardModel[] = [];
    const personaTeamMap = new Map<string, string | null>();
    for (const p of personas) personaTeamMap.set(p.id, p.home_team_id ?? null);

    for (const card of displayCards) {
      const gid = personaTeamMap.get(card.personaId) ?? null;
      if (gid === null) {
        ungrouped.push(card);
      } else {
        const bucket = byGroup.get(gid) ?? [];
        bucket.push(card);
        byGroup.set(gid, bucket);
      }
    }

    const groupOrder = [...teams].sort((a, b) => a.name.localeCompare(b.name));
    const sections: { group: PersonaTeam | null; cards: PersonaCardModel[] }[] = [];
    for (const g of groupOrder) {
      const bucket = byGroup.get(g.id);
      if (bucket && bucket.length > 0) sections.push({ group: g, cards: bucket });
    }
    if (ungrouped.length > 0) sections.push({ group: null, cards: ungrouped });
    return sections;
  }, [groupBy, displayCards, personas, teams]);

  // Tick once a second only while something is running.
  const anyRunning = useMemo(
    () => Object.values(activeProcesses).some((p) => p.status === 'running'),
    [activeProcesses],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const [selection, setSelection] = useState<Selection | null>(null);
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
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40 pointer-events-none" />
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground/80 transition-colors"
                  aria-label={t.monitor.clear_filter}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          {viewMode === 'fleet' && teams.length > 0 && (
            <button
              type="button"
              onClick={() => setGroupBy(groupBy === 'group' ? 'none' : 'group')}
              aria-pressed={groupBy === 'group'}
              title={t.monitor.group_by_toggle_title}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-body-lg transition-colors ${
                groupBy === 'group'
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                  : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
              }`}
            >
              <Layers className="w-3 h-3" />
              {t.monitor.group_by_toggle}
            </button>
          )}
          {teams.length > 0 && (
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
          )}
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
      /* Body — persona grid with the drawer layered over it */
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto px-5 py-4">
          {displayCards.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 typo-body text-foreground">
              {debouncedSearch ? tx(t.monitor.no_search_personas, { query: search.trim() }) : t.monitor.no_personas}
              {debouncedSearch && (
                <button
                  onClick={() => setSearch('')}
                  className="px-3 py-1.5 rounded-modal border border-primary/15 bg-secondary/20 typo-heading font-medium text-foreground hover:bg-secondary/40 transition-colors"
                >
                  {t.monitor.clear_filter}
                </button>
              )}
            </div>
          ) : groupedDisplay ? (
            <div className="space-y-5">
              {groupedDisplay.map(({ group, cards: groupCards }) => {
                const id = group?.id ?? '__ungrouped__';
                const collapsed = collapsedGroups.has(id);
                const color = group?.color ?? '#6b7280';
                return (
                  <section key={id}>
                    <button
                      type="button"
                      onClick={() => toggleMonitorGroupCollapsed(id)}
                      aria-expanded={!collapsed}
                      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-card border border-primary/10 hover:bg-secondary/30 transition-colors"
                      style={{ borderLeft: `3px solid ${colorWithAlpha(color, 0.8)}` }}
                    >
                      <Layers className="w-3.5 h-3.5" style={{ color: colorWithAlpha(color, 0.9) }} />
                      <span className="typo-heading text-foreground/90 font-semibold">
                        {group?.name ?? t.monitor.group_ungrouped}
                      </span>
                      <span className="typo-caption text-foreground font-mono">
                        {groupCards.length}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 ml-auto text-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`}
                      />
                    </button>
                    {!collapsed && (
                      <div
                        className="mt-2.5 grid gap-2.5"
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(184px, 1fr))' }}
                      >
                        {groupCards.map((card) => (
                          <PersonaCardTile
                            key={card.personaId}
                            card={card}
                            now={now}
                            isSelected={card.personaId === selection?.personaId}
                            onOpen={(section) => setSelection({ personaId: card.personaId, section })}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(184px, 1fr))' }}
            >
              {displayCards.map((card) => (
                <PersonaCardTile
                  key={card.personaId}
                  card={card}
                  now={now}
                  isSelected={card.personaId === selection?.personaId}
                  onOpen={(section) => setSelection({ personaId: card.personaId, section })}
                />
              ))}
            </div>
          )}
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

// ---------------------------------------------------------------------------
// Persona card — Pillar layout (v2)
// ---------------------------------------------------------------------------
//
// Anatomy:
//   ┌────────────────────────┐
//   │────────────────────────│  1px top strip (state colour, pulses if running)
//   │ Persona Name        ⟶ │  title button (primary open) · hover quick-open
//   │                        │
//   │ running · 2m 14s       │  state caption (live elapsed)
//   │ 12 tools · $0.03       │  live telemetry (running only)
//   │ ▪▪▪▫▪▪▪  92%           │  recent-run health micro-bar + success rate
//   │ [3⚠] [2✉]          🧠 │  badges left · icon signature bottom-right
//   └────────────────────────┘
//
// All visual/state logic is resolved by the pure helpers in monitorModel
// (pillarVisual / captionDescriptor / primaryDrawerSection / healthSegments)
// so the component is just markup + i18n.

/** Format a CaptionDescriptor into translated, live caption text. */
function captionText(
  desc: CaptionDescriptor,
  card: PersonaCardModel,
  now: number,
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
): string {
  switch (desc.key) {
    case 'running':
      return card.runningSince !== null
        ? `${t.monitor.status_running.toLowerCase()} · ${elapsedStr(card.runningSince, now)}`
        : t.monitor.status_running;
    case 'failed':
      return t.monitor.last_failed;
    case 'input_required':
      return desc.count > 1 ? tx(t.monitor.caption_input_many, { count: desc.count }) : t.monitor.status_input_required;
    case 'draft_ready':
      return desc.count > 1 ? tx(t.monitor.caption_draft_many, { count: desc.count }) : t.monitor.status_draft_ready;
    case 'queued':
      return desc.count > 1 ? tx(t.monitor.caption_queued_many, { count: desc.count }) : t.monitor.status_queued;
    case 'attention':
      return t.monitor.caption_pending;
    case 'idle':
      return t.monitor.idle;
  }
}

/** Recent-run health micro-bar: a fixed-width row of outcome ticks. */
function HealthBar({ card }: { card: PersonaCardModel }) {
  const { t, tx } = useTranslation();
  if (card.totalRecent === 0) return null;
  const segments = healthSegments(card, HEALTH_BAR_LENGTH);
  const pct = card.successRate !== null ? Math.round(card.successRate * 100) : null;
  const title = pct !== null
    ? tx(t.monitor.health_summary, { pct, today: card.runsToday })
    : undefined;
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className="flex items-center gap-px" aria-hidden>
        {segments.map((tone, i) => (
          <span key={i} className={`w-1.5 h-2 rounded-[1px] ${HEALTH_TONE_CLASS[tone]}`} />
        ))}
      </div>
      {pct !== null && (
        <span className="typo-caption text-foreground tabular-nums">{pct}%</span>
      )}
    </div>
  );
}

interface PersonaCardTileProps {
  card: PersonaCardModel;
  now: number;
  isSelected: boolean;
  onOpen: (section: DrawerSection) => void;
}

function PersonaCardTile({ card, now, isSelected, onOpen }: PersonaCardTileProps) {
  const { t, tx } = useTranslation();
  // Looping opacity animations slip through the global <MotionConfig
  // reducedMotion> (which only suppresses one-shot transforms), so gate the
  // top-strip pulse explicitly. Reduced-motion users see a steady mid-opacity
  // strip in the same colour, which still communicates "live" without flicker.
  const prefersReducedMotion = useReducedMotion();
  const v = pillarVisual(card);
  const muted = v.key === 'idle';
  const desc = captionDescriptor(card);
  const caption = captionText(desc, card, now, t, tx);
  const primary = primaryDrawerSection(card);
  const showTelemetry = card.running > 0 && (card.liveToolCalls > 0 || card.liveCostUsd > 0);

  return (
    <div
      title={card.personaName}
      className={`group relative overflow-hidden rounded-card border transition-colors ${v.cardBg} ${v.cardBorder} ${
        isSelected ? 'ring-2 ring-primary/45' : ''
      } hover:bg-secondary/30`}
    >
      {/* 1px top strip — the state focal point */}
      {v.pulse && !prefersReducedMotion ? (
        <motion.span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-[1px] ${v.strip}`}
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-[1px] ${v.strip} ${v.pulse ? 'opacity-80' : ''}`}
        />
      )}

      {/* Hover quick-open — opens the capabilities drawer to quick-fire. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen('capabilities'); }}
        aria-label={`${card.personaName} — ${t.monitor.view_capabilities}`}
        title={t.monitor.view_capabilities}
        className="absolute top-1.5 right-1.5 z-10 flex items-center justify-center w-5 h-5 rounded-full border border-primary/20 bg-background/70 text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-primary hover:border-primary/40"
      >
        <Wrench className="w-2.5 h-2.5" />
      </button>

      {/* Title anchors top, caption + health + badges + icon group anchor bottom. */}
      <div className="relative flex flex-col justify-between gap-2 px-3 pt-3 pb-2.5 min-h-[104px]">
        {/* Title is the primary open affordance for every card. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(primary); }}
          className={`self-start text-left typo-body font-semibold leading-snug line-clamp-2 rounded-[2px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
            muted ? 'text-foreground/60 hover:text-foreground/90' : 'text-foreground/95 hover:text-primary'
          }`}
        >
          {card.personaName}
        </button>

        <div className="flex flex-col gap-1.5">
          {/* State caption — clickable when it points at a drawer section */}
          {desc.target ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(desc.target!); }}
              className={`self-start typo-caption font-medium ${v.captionText} hover:underline focus-visible:outline-none focus-visible:underline tabular-nums`}
              aria-label={`${caption} — ${t.monitor.open_activity}`}
            >
              {caption}
            </button>
          ) : (
            <span className={`typo-caption ${v.captionText} tabular-nums`}>{caption}</span>
          )}

          {/* Live telemetry — running cards only */}
          {showTelemetry && (
            <span className="typo-caption text-foreground tabular-nums font-mono">
              {tx(t.monitor.live_telemetry, { tools: card.liveToolCalls, cost: card.liveCostUsd.toFixed(3) })}
            </span>
          )}

          {/* Recent-run health micro-bar */}
          <HealthBar card={card} />

          {/* Bottom row — badges left, icon signature right */}
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {card.topReviewSeverity && (
                <AttentionBadge
                  label={tx(t.monitor.open_reviews_with_count, { count: card.reviews.length })}
                  count={card.reviews.length}
                  className={SEVERITY_META[card.topReviewSeverity].badge}
                  icon={SEVERITY_META[card.topReviewSeverity].icon}
                  onClick={(e) => { e.stopPropagation(); onOpen('reviews'); }}
                />
              )}
              {card.messages.length > 0 && (
                <AttentionBadge
                  label={tx(t.monitor.open_messages_with_count, { count: card.messages.length })}
                  count={card.messages.length}
                  className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                  icon={Mail}
                  onClick={(e) => { e.stopPropagation(); onOpen('messages'); }}
                />
              )}
            </div>
            <span
              aria-hidden
              className={`flex-shrink-0 transition-opacity ${
                muted ? 'opacity-40 group-hover:opacity-65' : 'opacity-70 group-hover:opacity-95'
              }`}
            >
              <PersonaIcon icon={card.personaIcon} color={card.personaColor} display="pop" frameSize="sm" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AttentionBadgeProps {
  label: string;
  count: number;
  className: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: (e: React.MouseEvent) => void;
}

function AttentionBadge({ label, count, className, icon: Icon, onClick }: AttentionBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border typo-caption font-medium transition-transform hover:scale-105 ${className}`}
    >
      <Icon className="w-3 h-3" />
      {count}
    </button>
  );
}


export default PersonaMonitor;
