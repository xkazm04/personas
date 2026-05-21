// PersonaMonitor — the full-screen fleet monitor.
//
// One card per persona, fleet-wide. Card COLOUR encodes execution state
// (running pulses, failed is red, attention uses the default tone, idle is
// muted). BADGES encode required attention — a review badge and a messages
// badge, each opening that section of the drawer. The activity dot opens the
// Activity section. There is no whole-card click; every action is a badge.

import { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Activity, Mail, FolderGit2 } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useCodebasePersonas } from '@/hooks/sidebar/useCodebasePersonas';
import { useMonitorData } from './useMonitorData';
import { MonitorDrawer } from './MonitorDrawer';
import {
  buildMonitorModel, SEVERITY_META, EXEC_STATE_META,
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
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
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
      <div className="relative flex-1 min-h-0 overflow-hidden">
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
          ) : (
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}
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
      <div className="flex-shrink-0 h-9 px-6 flex items-center justify-between border-t border-primary/8 bg-secondary/10 typo-caption text-foreground">
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
    <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 border-b border-primary/8 bg-secondary/12 overflow-x-auto">
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
// Persona card
// ---------------------------------------------------------------------------

interface PersonaCardTileProps {
  card: PersonaCardModel;
  now: number;
  isSelected: boolean;
  onOpen: (section: DrawerSection) => void;
}

function PersonaCardTile({ card, now, isSelected, onOpen }: PersonaCardTileProps) {
  const { t } = useTranslation();
  const M = EXEC_STATE_META[card.execState];
  const muted = card.execState === 'idle';
  const hasProcesses = card.running + card.queued + card.inputRequired + card.draftReady > 0;

  // The dominant process status drives the activity-dot colour.
  const procMeta = processStatusMeta(
    card.running > 0 ? 'running'
      : card.inputRequired > 0 ? 'input_required'
        : card.draftReady > 0 ? 'draft_ready'
          : 'queued',
  );

  // Idle cards carry no badges, so the whole card becomes the affordance —
  // a click opens the drawer's Capabilities section for quick execution.
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
      className={`relative flex flex-col gap-2 rounded-card border px-3 py-2.5 transition-colors ${M.card} ${
        isSelected ? 'ring-2 ring-primary/45' : ''
      } ${muted ? 'cursor-pointer hover:bg-secondary/30' : ''}`}
    >
      {/* Pulsing ring — live work */}
      {M.pulse && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-card border border-primary/60 pointer-events-none"
          animate={{ opacity: [0.2, 0.7, 0.2] }}
          transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Row 1 — identity + activity affordance */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={muted ? 'opacity-45' : ''}>
          <PersonaIcon icon={card.personaIcon} color={card.personaColor} display="pop" frameSize="sm" />
        </span>
        <span className={`typo-body font-medium truncate flex-1 ${muted ? 'text-foreground/45' : 'text-foreground/90'}`}>
          {card.personaName}
        </span>
        {hasProcesses && (
          <button
            type="button"
            onClick={() => onOpen('activity')}
            aria-label={t.monitor.open_activity}
            title={t.monitor.open_activity}
            className="flex items-center gap-1 flex-shrink-0 rounded-full px-1.5 py-0.5 hover:bg-foreground/8 transition-colors"
          >
            <span className="relative flex w-2 h-2">
              {procMeta.pulse && (
                <span className={`absolute inline-flex w-full h-full rounded-full ${procMeta.dot} opacity-60 animate-ping`} />
              )}
              <span className={`relative inline-flex w-2 h-2 rounded-full ${procMeta.dot}`} />
            </span>
            {card.running > 0 && card.runningSince !== null && (
              <span className="typo-caption font-medium text-primary">{elapsedStr(card.runningSince, now)}</span>
            )}
          </button>
        )}
      </div>

      {/* Row 2 — attention badges */}
      <div className="flex items-center gap-1.5 flex-wrap min-h-[22px]">
        {card.topReviewSeverity && (
          <AttentionBadge
            label={t.monitor.open_reviews}
            count={card.reviews.length}
            className={SEVERITY_META[card.topReviewSeverity].badge}
            icon={SEVERITY_META[card.topReviewSeverity].icon}
            onClick={() => onOpen('reviews')}
          />
        )}
        {card.messages.length > 0 && (
          <AttentionBadge
            label={t.monitor.open_messages}
            count={card.messages.length}
            className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
            icon={Mail}
            onClick={() => onOpen('messages')}
          />
        )}
        {card.topReviewSeverity === null && card.messages.length === 0 && (
          <span className={`typo-caption ${card.execState === 'failed' ? 'text-red-400/80' : 'text-foreground/40'}`}>
            {card.execState === 'failed' ? t.monitor.last_failed : card.execState === 'idle' ? t.monitor.idle : ''}
          </span>
        )}
      </div>
    </div>
  );
}

interface AttentionBadgeProps {
  label: string;
  count: number;
  className: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
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
