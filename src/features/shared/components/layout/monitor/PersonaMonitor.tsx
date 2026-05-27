// PersonaMonitor — the full-screen fleet monitor.
//
// One card per persona, fleet-wide. The 2px-tall fleet ActivityStrip below
// the header gives a single-glance read of the most urgent slice of the
// fleet. Each persona card is a "pillar" — a colour-tinted top strip encodes
// execution state, the title fills the full width (2-line clamp), a state
// caption opens the relevant drawer section, and the persona icon shrinks to
// a signature mark in the bottom-right. Reviews and messages get their own
// badges in the bottom row.

import { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Activity, Mail, FolderGit2, Layers, ChevronDown } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useIsDarkTheme } from '@/stores/themeStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useCodebasePersonas } from '@/hooks/sidebar/useCodebasePersonas';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { useMonitorData } from './useMonitorData';
import { MonitorDrawer } from './MonitorDrawer';
import {
  buildMonitorModel, SEVERITY_META,
  processStatusMeta, processStatusLabel, severityLabel, elapsedStr, severityBucket,
  type PersonaCardModel, type SeverityBucket, type ProcessEntry, type DrawerSection,
} from './monitorModel';

interface PersonaMonitorProps {
  onClose: () => void;
}

const SEVERITIES: SeverityBucket[] = ['critical', 'warning', 'info'];

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

  // Dev Tools project filter — when a project is active in the footer
  // picker, narrow the grid to personas wired to a codebase connector
  // (mirrors the Agents sidebar's active-project section).
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const codebasePersonaIds = useCodebasePersonas();
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const displayCards = useMemo(
    () => (activeProjectId ? cards.filter((c) => codebasePersonaIds.has(c.personaId)) : cards),
    [cards, activeProjectId, codebasePersonaIds],
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

  const severityCounts = useMemo(() => {
    const c: Record<SeverityBucket, number> = { critical: 0, warning: 0, info: 0 };
    for (const r of reviews) c[severityBucket(r.severity)] += 1;
    return c;
  }, [reviews]);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selection?.personaId) ?? null,
    [personas, selection],
  );

  // Faint network-of-agents backdrop — dark mode only (the light-theme
  // alternative is a follow-up). Rendered behind everything at low opacity so
  // it reads as premium texture, not a competing foreground.
  const isDark = useIsDarkTheme();

  const attentionCards = displayCards.filter((c) => c.attentionCount > 0).length;
  const runningCount = useMemo(
    () => Object.values(activeProcesses).filter((p) => p.status === 'running').length,
    [activeProcesses],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 bg-background/98 backdrop-blur-xl flex flex-col"
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

      {/* Header */}
      <div className="relative z-10 flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="typo-heading font-semibold text-foreground leading-tight">{t.monitor.title}</h2>
            <p className="typo-caption text-foreground leading-tight">
              {tx(t.monitor.subtitle, { personas: displayCards.length, attention: attentionCards, running: runningCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeProject && (
            <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 typo-caption">
              <FolderGit2 className="w-3 h-3" />
              <span className="max-w-[140px] truncate">{activeProject.name}</span>
              <button
                onClick={() => void setActiveProject(null)}
                aria-label={t.monitor.clear_filter}
                title={t.monitor.clear_filter}
                className="p-0.5 rounded-full hover:bg-indigo-500/20 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {teams.length > 0 && (
            <button
              type="button"
              onClick={() => setGroupBy(groupBy === 'group' ? 'none' : 'group')}
              aria-pressed={groupBy === 'group'}
              title={t.monitor.group_by_toggle_title}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption transition-colors ${
                groupBy === 'group'
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                  : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
              }`}
            >
              <Layers className="w-3 h-3" />
              {t.monitor.group_by_toggle}
            </button>
          )}
          {SEVERITIES.map((sev) =>
            severityCounts[sev] > 0 ? (
              <span
                key={sev}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border typo-caption ${SEVERITY_META[sev].chip}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_META[sev].dot}`} />
                {severityCounts[sev]} {severityLabel(t, sev).toLowerCase()}
              </span>
            ) : null,
          )}
          {unreadMessages.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 typo-caption">
              <Mail className="w-3 h-3" />
              {unreadMessages.length}
            </span>
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

      {/* System band — app-level activity with no persona */}
      <SystemBand processes={systemProcesses} now={now} />

      {/* Body — persona grid with the drawer layered over it */}
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto px-5 py-4">
          {displayCards.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 typo-body text-foreground">
              {activeProjectId ? t.monitor.no_project_personas : t.monitor.no_personas}
              {activeProjectId && (
                <button
                  onClick={() => void setActiveProject(null)}
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
// Persona card — Pillar layout
// ---------------------------------------------------------------------------
//
// Anatomy:
//   ┌────────────────────────┐
//   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  4px top strip (state colour, pulses if running)
//   │ Persona Name           │  title — full width, 2-line clamp
//   │ running · 2m 14s       │  state caption (click → state's drawer section)
//   │ [3⚠] [2✉]          🧠 │  badges left · icon signature bottom-right
//   └────────────────────────┘
//
// The strip and the state caption together replace the prior whole-card
// background tinting + pulsing ring + activity dot — fewer competing
// signals, more legible at mass scale.

interface PillarStateVisual {
  /** Top-strip class (background colour and any animation hint). */
  strip: string;
  /** State caption text class. */
  captionText: string;
  /** Subtle card background tint, kept very light so the strip stays the focal point. */
  cardBg: string;
  /** Card border colour. */
  cardBorder: string;
  /** Whether the strip should pulse opacity (live work). */
  pulse: boolean;
}

// Resolved per-card by precedence: running > failed > input_required >
// draft_ready > queued > attention > idle. Kept inline so the card file is
// the single source of truth for its own visual contract.
function pillarVisuals(card: PersonaCardModel): PillarStateVisual {
  if (card.running > 0) {
    return {
      strip: 'bg-primary',
      captionText: 'text-primary',
      cardBg: 'bg-primary/[0.06]',
      cardBorder: 'border-primary/35',
      pulse: true,
    };
  }
  if (card.execState === 'failed') {
    return {
      strip: 'bg-red-400',
      captionText: 'text-red-400',
      cardBg: 'bg-red-500/[0.07]',
      cardBorder: 'border-red-500/30',
      pulse: false,
    };
  }
  if (card.inputRequired > 0) {
    return {
      strip: 'bg-amber-400',
      captionText: 'text-amber-300',
      cardBg: 'bg-amber-500/[0.06]',
      cardBorder: 'border-amber-500/25',
      pulse: true,
    };
  }
  if (card.draftReady > 0) {
    return {
      strip: 'bg-violet-400',
      captionText: 'text-violet-300',
      cardBg: 'bg-violet-500/[0.06]',
      cardBorder: 'border-violet-500/25',
      pulse: false,
    };
  }
  if (card.queued > 0) {
    return {
      strip: 'bg-primary/55',
      captionText: 'text-primary/85',
      cardBg: 'bg-secondary/30',
      cardBorder: 'border-primary/15',
      pulse: false,
    };
  }
  if (card.attentionCount > 0) {
    return {
      strip: 'bg-amber-300/70',
      captionText: 'text-foreground/70',
      cardBg: 'bg-secondary/30',
      cardBorder: 'border-primary/15',
      pulse: false,
    };
  }
  return {
    strip: 'bg-primary/15',
    captionText: 'text-foreground/45',
    cardBg: 'bg-secondary/15',
    cardBorder: 'border-primary/8',
    pulse: false,
  };
}

interface CaptionContent {
  text: string;
  /** Drawer section to open when the caption is clicked. Null = caption is not clickable. */
  target: DrawerSection | null;
}

function captionContent(
  card: PersonaCardModel,
  now: number,
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
): CaptionContent {
  if (card.running > 0 && card.runningSince !== null) {
    return {
      text: `${t.monitor.status_running.toLowerCase()} · ${elapsedStr(card.runningSince, now)}`,
      target: 'activity',
    };
  }
  if (card.execState === 'failed') return { text: t.monitor.last_failed, target: 'activity' };
  if (card.inputRequired > 0) {
    return {
      text: card.inputRequired > 1
        ? tx(t.monitor.caption_input_many, { count: card.inputRequired })
        : t.monitor.status_input_required,
      target: 'activity',
    };
  }
  if (card.draftReady > 0) {
    return {
      text: card.draftReady > 1
        ? tx(t.monitor.caption_draft_many, { count: card.draftReady })
        : t.monitor.status_draft_ready,
      target: 'activity',
    };
  }
  if (card.queued > 0) {
    return {
      text: card.queued > 1
        ? tx(t.monitor.caption_queued_many, { count: card.queued })
        : t.monitor.status_queued,
      target: 'activity',
    };
  }
  if (card.attentionCount > 0) {
    // Badges already convey the kind — caption stays passive.
    return { text: t.monitor.caption_pending, target: null };
  }
  return { text: t.monitor.idle, target: null };
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
  const v = pillarVisuals(card);
  const muted = card.execState === 'idle';
  const caption = captionContent(card, now, t, tx);

  // Idle cards still use the whole-card affordance — clicking opens the
  // Capabilities drawer so the user can quick-fire the persona.
  const idleProps = muted
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': `${card.personaName} — ${t.monitor.view_capabilities}`,
        onClick: () => onOpen('capabilities'),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen('capabilities');
          }
        },
      }
    : {};

  return (
    <div
      {...idleProps}
      title={card.personaName}
      className={`group relative overflow-hidden rounded-card border transition-colors ${v.cardBg} ${v.cardBorder} ${
        isSelected ? 'ring-2 ring-primary/45' : ''
      } ${muted ? 'cursor-pointer hover:bg-secondary/35' : 'hover:bg-secondary/25'}`}
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

      {/* Title anchors top, caption + badges + icon group anchor bottom. */}
      <div className="relative flex flex-col justify-between gap-2 px-3 pt-3 pb-2.5 min-h-[96px]">
        <h4
          className={`typo-body font-semibold leading-snug line-clamp-2 ${muted ? 'text-foreground/55' : 'text-foreground/95'}`}
        >
          {card.personaName}
        </h4>

        <div className="flex flex-col gap-1.5">
          {/* State caption — clickable when it points at a drawer section */}
          {caption.target ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(caption.target!);
              }}
              className={`self-start typo-caption font-medium ${v.captionText} hover:underline focus-visible:outline-none focus-visible:underline tabular-nums`}
              aria-label={`${caption.text} — ${t.monitor.open_activity}`}
            >
              {caption.text}
            </button>
          ) : (
            <span className={`typo-caption ${v.captionText} tabular-nums`}>{caption.text}</span>
          )}

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
