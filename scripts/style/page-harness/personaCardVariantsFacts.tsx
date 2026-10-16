/**
 * What a persona card can say (WP11 phase A), from reads the board already
 * holds, plus the one it does not yet (`list_cron_agents`). Every field names
 * its source; a field nobody fills is absent here, never invented:
 *
 *   state, reason, count   PersonaCardModel (pileKey / needReason / actionBadges) - the board's own model
 *   running for            card.runningSince  <- PROCESS_ACTIVITY "started" event (overviewStore.activeProcesses)
 *   queued                 card.queued        <- QUEUE_STATUS "queued" event (same store)
 *   last run outcome       card.recentStatuses[0] <- get_persona_summaries.health (agentStore.personaHealthMap)
 *   last run age           agentStore.personaLastRun <- get_persona_summaries.lastRunAt (same read)
 *   runs today             card.runsToday     <- get_persona_summaries.health.runsToday
 *   run budget             persona.timeout_ms <- list_personas (agentStore.personas), the run's time cap
 *   next schedule          overviewStore.cronAgents.next_trigger_at <- list_cron_agents (NOT read by the board today)
 *   peer                   DeviceAgent.running / enabled / projectEnabled <- the device snapshot
 *
 * Dropped, because nothing fills them: the run's TITLE (the execution's
 * PROCESS_ACTIVITY label is the persona's own name, runner/mod.rs), its live
 * tool calls and cost (`enrichProcess` has no caller, so both stay 0).
 */
import { CheckCircle2, CircleSlash, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaCardModel } from '@/features/fleet/monitor/monitorModel';
import { needReason, REASON_LABEL_KEY, type PileKey } from '@/features/fleet/monitor/grid/skin/piles';
import { shortElapsed, usePersonaFacts } from '@/features/fleet/monitor/grid/prototype/shared';
import { personaLinePileKey } from '@/features/fleet/monitor/grid/prototype/entry-e/pileSkin';
import { compactAge, type Lamp, type Tone } from '@/features/fleet/monitor/grid/prototype/entry-e/tone';
import type { PeerLineInfo } from '@/features/fleet/monitor/grid/prototype/entry-e/PersonaLine';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';

/** The props `PersonaLine` was rendered with (read off its fiber by the swap). */
export interface LineProps {
  card: PersonaCardModel;
  selected: boolean;
  now: number;
  unseenChat: number;
  peer?: PeerLineInfo | null;
}

export const KIND_TONE: Record<PileKey, Tone> = { critical: 'err', warning: 'warn', working: 'run', resting: 'off', off: 'off' };

export interface Outcome { Icon: LucideIcon; ink: string; age: string | null }

export interface CardFacts {
  name: string;
  kind: PileKey;
  tone: Tone;
  lamp: Lamp;
  /** Why it needs you, in words, its count, and how many more reasons. */
  reason: { word: string; count: number; more: number } | null;
  /** While a run is live: its elapsed time, and how many more wait behind it. */
  running: { elapsed: string; queued: number; budget: number | null } | null;
  last: Outcome | null;
  next: string | null;
  runsToday: number;
  recent: string[];
  /** A peer's device, when the card is another device's agent. */
  device: string | null;
}

const OUTCOME: Record<string, { Icon: LucideIcon; ink: string }> = {
  completed: { Icon: CheckCircle2, ink: 'text-status-success' },
  failed: { Icon: XCircle, ink: 'text-status-error' },
  cancelled: { Icon: CircleSlash, ink: 'text-foreground' },
};

/** `14:30` today, `Tue 14:30` within the week, `13 Oct` beyond it, in the reader's language. */
export function clock(ms: number, language: string, now: number): string {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const opts: Intl.DateTimeFormatOptions = sameDay ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : ms - now < 6 * 86_400_000 ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(language, opts).format(d);
}

export function useCardFacts({ card, now, peer = null }: LineProps): CardFacts {
  const { t, language } = useTranslation();
  const facts = usePersonaFacts()(card);
  const offProject = useOffProjectForPersona(peer ? null : card.personaId);
  const lastRunAt = useAgentStore((s) => s.personaLastRun[card.personaId] ?? null);
  const cron = useOverviewStore((s) => s.cronAgents);
  const timeoutMs = useAgentStore((s) => s.personas.find((x) => x.id === card.personaId)?.timeout_ms ?? null);
  const kind = personaLinePileKey(card, offProject !== null || peer?.agent.projectEnabled === false);
  const tone = KIND_TONE[kind];
  const lead = facts.pending[0] ?? null;
  const r = needReason(card);
  const nextMs = peer ? null : cron
    .filter((a) => a.persona_id === card.personaId && a.trigger_enabled && a.next_trigger_at)
    .map((a) => Date.parse(a.next_trigger_at as string))
    .filter((ms) => ms > now)
    .sort((a, b) => a - b)[0] ?? null;
  const outcome = card.recentStatuses[0];
  const shape = outcome ? OUTCOME[outcome] ?? OUTCOME.cancelled : null;
  return {
    name: facts.name,
    kind,
    tone,
    lamp: { tone, lit: kind !== 'resting' && kind !== 'off' },
    reason: r ? { word: t.monitor[REASON_LABEL_KEY[r]], count: lead?.count ?? 0, more: Math.max(0, facts.pending.length - 1) } : null,
    running: card.runningSince !== null ? {
      elapsed: shortElapsed(card.runningSince, now),
      queued: card.queued,
      budget: timeoutMs ? Math.min(1, Math.max(0, (now - card.runningSince) / timeoutMs)) : null,
    } : null,
    last: shape ? { ...shape, age: lastRunAt ? compactAge(Math.max(0, now - Date.parse(lastRunAt))) : null } : null,
    next: nextMs !== null ? clock(nextMs, language, now) : null,
    runsToday: card.runsToday,
    recent: card.recentStatuses,
    device: peer?.device ?? null,
  };
}
