/**
 * GhostCables — the Self-Wiring Fabric's suggestion surface in the Studio
 * patchbay ledger. Each mined candidate renders as a "ghost" patch cable
 * (dashed, primary-tinted — visually distinct from the amber draft cables):
 *
 *   [event] ──(observed n×)──▶ [persona]   [evidence] [wire] [dismiss]
 *
 * The evidence drawer expands inline and lists the ACTUAL historical
 * co-occurrences (event → manual run, gap) — the drawer is the trust
 * mechanism, so it shows real observations, never aggregates alone.
 *
 * Sparse-data honesty: when the miner is on but has nothing above threshold,
 * a one-line "not enough signal yet" state explains the bar; when no project
 * grants AutomationSuggestion, the line says the miner is off instead of
 * pretending to be listening.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronDown, ChevronUp, Plug, Sparkles, X } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { AutomationSuggestion } from '@/lib/bindings/AutomationSuggestion';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { findTemplateByEventType } from '@/features/triggers/lib/eventSourceTemplates';
import { resolveIcon } from '../routing/layouts/routingHelpers';
import type { AutomationSuggestionsState } from './useAutomationSuggestions';
import Button from '@/features/shared/components/buttons/Button';

export function GhostCables({ sug, personas }: {
  sug: AutomationSuggestionsState;
  personas: Persona[];
}) {
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;
  const { feed, proposed } = sug;
  if (!feed) return null; // still loading — the ledger has its own spinner rhythm

  if (proposed.length === 0) {
    // Honest empty line, never a stretched inference. Distinguish "miner is
    // off" from "miner is watching but the bar isn't met yet".
    return (
      <div className="flex items-center gap-2 px-4 py-2 typo-caption text-ink-2 opacity-60">
        <Sparkles className="w-3.5 h-3.5 shrink-0" />
        <span>
          {feed.minerEnabled
            ? tx(st.ghost_not_enough_signal, { count: feed.minCoOccurrences })
            : st.ghost_miner_off}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="pt-1 pb-1 px-1 flex items-center gap-1.5 typo-eyebrow text-ink-1 opacity-80">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        {st.ghost_section_title}
      </div>
      {proposed.map((s) => (
        <GhostCableRow key={s.id} s={s} sug={sug} personas={personas} />
      ))}
    </>
  );
}

function GhostCableRow({ s, sug, personas }: {
  s: AutomationSuggestion;
  sug: AutomationSuggestionsState;
  personas: Persona[];
}) {
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;
  const [open, setOpen] = useState(false);
  const persona = personas.find((p) => p.id === s.personaId);
  const template = findTemplateByEventType(s.eventType);
  const EventIcon = resolveIcon(template);
  const busy = sug.busy.has(s.id);

  return (
    <div className="rounded-card border border-dashed border-primary/40 bg-surface-1 max-w-[calc(100%-50px)]">
      <div className="group flex items-center gap-3 px-4 py-2.5">
        <span className="flex items-center gap-1.5 min-w-0 shrink text-ink-1">
          <EventIcon className="w-4 h-4 shrink-0 text-primary" />
          <span className="typo-body truncate max-w-[10rem]">{template?.label ?? s.eventType}</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-px w-4 border-t border-dashed border-primary/50" />
          <Button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            tooltip={st.ghost_evidence_hint}
            variant="secondary"
            size="xs"
          >
            {tx(st.ghost_observed_count, { count: s.occurrenceCount })}
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <div className="h-px w-4 border-t border-dashed border-primary/50" />
          <ArrowRight className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="flex items-center gap-2 min-w-0 shrink">
          <PersonaIcon icon={persona?.icon} color={persona?.color} display="framed" frameSize="sm" />
          <span className="typo-body text-ink-1 truncate">
            {persona?.name ?? s.personaId.slice(0, 8)}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            onClick={() => { if (!busy) void sug.accept(s); }}
            disabled={busy}
            tooltip={st.ghost_accept_hint}
            aria-label={st.ghost_accept}
            variant="ghost"
            size="sm"
            icon={busy ? <LoadingSpinner size="sm" /> : <Plug className="w-3.5 h-3.5" />}
          >{st.ghost_accept}</Button>
          <Button
            type="button"
            onClick={() => { if (!busy) void sug.reject(s); }}
            disabled={busy}
            tooltip={st.ghost_reject_hint}
            aria-label={st.ghost_reject}
            variant="ghost"
            size="icon-sm"
            icon={<X className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      {/* Evidence drawer — the N real co-occurrences behind the suggestion */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-dashed border-hair"
          >
            <div className="px-4 py-2.5 space-y-1.5">
              <div className="typo-caption text-ink-2 opacity-70">
                {tx(st.ghost_evidence_summary, {
                  matched: s.occurrenceCount,
                  total: s.manualRunCount,
                  days: s.lookbackDays,
                })}
              </div>
              {s.evidence.map((ev) => (
                <div key={`${ev.eventId}-${ev.executionId}`} className="flex items-center gap-2 typo-caption text-ink-2">
                  <EventIcon className="w-3 h-3 shrink-0 text-primary opacity-70" />
                  <span className="opacity-80">{formatTs(ev.eventAt)}</span>
                  <ArrowRight className="w-3 h-3 shrink-0 opacity-50" />
                  <span className="opacity-80">
                    {tx(st.ghost_evidence_ran, { gap: formatGap(ev.gapSeconds) })}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatGap(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}
