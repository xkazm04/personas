// PersonaMonitor — the full-screen fleet monitor.
//
// One card per persona, fleet-wide. Card COLOUR = highest attention bucket
// (critical review > input-required > warning > draft-ready > info); a live
// PULSE marks personas with running work. App-level activity that can't be
// attributed to a persona sits in the System band above the grid. Clicking a
// card opens the MonitorDrawer, which slides down over the grid.

import { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Activity, MessageCircleQuestion, FileText } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { useMonitorData } from './useMonitorData';
import { MonitorDrawer } from './MonitorDrawer';
import {
  buildMonitorModel, ATTENTION_META, MUTED_CARD, BUSY_CARD,
  processStatusMeta, processStatusLabel, attentionLabel, elapsedStr, reviewBucket,
  type PersonaCardModel, type SeverityBucket, type ProcessEntry,
} from './monitorModel';

interface PersonaMonitorProps {
  onClose: () => void;
}

const SEVERITIES: SeverityBucket[] = ['critical', 'warning', 'info'];

export function PersonaMonitor({ onClose }: PersonaMonitorProps) {
  const { t, tx } = useTranslation();
  const { personas, reviews, activeProcesses, isProcessing, handleAction } = useMonitorData();

  const { cards, systemProcesses } = useMemo(
    () => buildMonitorModel(personas, reviews, activeProcesses),
    [personas, reviews, activeProcesses],
  );

  // Tick once a second only while something is running, so the elapsed
  // timers stay live without burning a render loop on an idle fleet.
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

  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const selectedCard = useMemo(
    () => cards.find((c) => c.personaId === selectedPersonaId) ?? null,
    [cards, selectedPersonaId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedPersonaId) setSelectedPersonaId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPersonaId, onClose]);

  const severityCounts = useMemo(() => {
    const c: Record<SeverityBucket, number> = { critical: 0, warning: 0, info: 0 };
    for (const r of reviews) c[reviewBucket(r.severity)] += 1;
    return c;
  }, [reviews]);

  const attentionCards = cards.filter((c) => c.attention !== null).length;
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
              {tx(t.monitor.subtitle, { personas: cards.length, attention: attentionCards, running: runningCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {SEVERITIES.map((sev) =>
            severityCounts[sev] > 0 ? (
              <span
                key={sev}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border typo-caption ${ATTENTION_META[sev].chip}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${ATTENTION_META[sev].dot}`} />
                {severityCounts[sev]} {attentionLabel(t, sev).toLowerCase()}
              </span>
            ) : null,
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
          {cards.length === 0 ? (
            <div className="h-full flex items-center justify-center typo-body text-foreground">
              {t.monitor.no_personas}
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
            >
              {cards.map((card) => (
                <PersonaCardTile
                  key={card.personaId}
                  card={card}
                  now={now}
                  isSelected={card.personaId === selectedPersonaId}
                  onOpen={setSelectedPersonaId}
                />
              ))}
            </div>
          )}
        </div>

        <AnimatePresence>
          {selectedCard && (
            <>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setSelectedPersonaId(null)}
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
                  isProcessing={isProcessing}
                  now={now}
                  onAction={(id, status, notes) => void handleAction(id, status, notes)}
                  onClose={() => setSelectedPersonaId(null)}
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
  onOpen: (personaId: string) => void;
}

function PersonaCardTile({ card, now, isSelected, onOpen }: PersonaCardTileProps) {
  const { t } = useTranslation();
  const busy = card.running > 0 || card.queued > 0;
  const interactive = card.attention !== null || busy;
  const muted = !interactive;
  const cardClass = card.attention
    ? ATTENTION_META[card.attention].card
    : busy ? BUSY_CARD : MUTED_CARD;

  return (
    <button
      type="button"
      disabled={muted}
      onClick={muted ? undefined : () => onOpen(card.personaId)}
      title={card.personaName}
      className={`group flex flex-col gap-2 rounded-card border px-3 py-2.5 text-left transition-all ${cardClass} ${
        muted ? 'cursor-default' : 'cursor-pointer'
      } ${isSelected ? 'ring-2 ring-primary/40' : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={muted ? 'opacity-40' : ''}>
          <PersonaIcon icon={card.personaIcon} color={card.personaColor} display="pop" frameSize="sm" />
        </span>
        <span className={`typo-body font-medium truncate flex-1 ${muted ? 'text-foreground/40' : 'text-foreground/90'}`}>
          {card.personaName}
        </span>
        {card.running > 0 && (
          <span className="relative flex w-2 h-2 flex-shrink-0" aria-hidden>
            <span className="absolute inline-flex w-full h-full rounded-full bg-primary/60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-primary" />
          </span>
        )}
      </div>

      {muted ? (
        <span className="typo-caption text-foreground/40">{t.monitor.idle}</span>
      ) : (
        <div className="flex items-center gap-1 flex-wrap">
          {SEVERITIES.map((sev) =>
            card.reviewCounts[sev] > 0 ? (
              <span
                key={sev}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption font-medium ${ATTENTION_META[sev].badge}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${ATTENTION_META[sev].dot}`} />
                {card.reviewCounts[sev]}
              </span>
            ) : null,
          )}
          {card.inputRequired > 0 && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption font-medium ${ATTENTION_META.input_required.badge}`}>
              <MessageCircleQuestion className="w-3 h-3" />
              {card.inputRequired}
            </span>
          )}
          {card.draftReady > 0 && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption font-medium ${ATTENTION_META.draft_ready.badge}`}>
              <FileText className="w-3 h-3" />
              {card.draftReady}
            </span>
          )}
          {card.running > 0 && card.runningSince !== null && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption font-medium bg-primary/15 text-primary">
              {elapsedStr(card.runningSince, now)}
            </span>
          )}
          {card.queued > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-caption font-medium bg-amber-500/15 text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {card.queued}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default PersonaMonitor;
