import { Zap, X, GitBranch, type LucideIcon, Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow, Layers, FileEdit, CheckCircle2, XCircle, Store } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import {
  EVENT_SOURCE_CATEGORIES,
  findTemplateByEventType,
  type EventSourceTemplate,
} from '../libs/eventCanvasConstants';

// ---------------------------------------------------------------------------
// Icon resolution
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
};

export function resolveIcon(tmpl: EventSourceTemplate | undefined): LucideIcon {
  if (!tmpl) return Zap;
  const name = tmpl.icon?.displayName;
  return name ? (ICON_MAP[name] ?? Zap) : Zap;
}

// ---------------------------------------------------------------------------
// PersonaChip
// ---------------------------------------------------------------------------

interface PersonaChipProps {
  persona: Persona | undefined;
  personaIdFallback: string;
  badge?: { text: string; title?: string };
  onRemove?: () => void;
}

export function PersonaChip({ persona, personaIdFallback, badge, onRemove }: PersonaChipProps) {
  return (
    <div className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-card bg-card border border-emerald-400/20 hover:border-emerald-400/40 group/chip transition-colors">
      <PersonaIcon
        icon={persona?.icon ?? null}
        color={persona?.color ?? null}
        display="framed"
        frameSize="md"
      />
      <span className="typo-body text-foreground">
        {persona?.name ?? personaIdFallback.slice(0, 8)}
      </span>
      {badge && (
        <span
          title={badge.title}
          className="ml-0.5 inline-flex items-center gap-0.5 px-1 py-[1px] rounded text-[9px] font-semibold uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-400/20"
        >
          <GitBranch className="w-2.5 h-2.5" />
          {badge.text}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-0.5 rounded opacity-0 group-hover/chip:opacity-100 hover:bg-red-500/15 text-red-400/50 hover:text-red-400 transition-all"
          title="Disconnect"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chain trigger parsing
// ---------------------------------------------------------------------------

export interface ChainTriggerView {
  trigger: PersonaTrigger;
  sourcePersonaId: string;
  eventType: string;
  conditionType: string;
}

export function parseChainTrigger(t: PersonaTrigger): ChainTriggerView | null {
  if (t.trigger_type !== 'chain' || !t.config) return null;
  try {
    const cfg = JSON.parse(t.config) as {
      source_persona_id?: string;
      event_type?: string;
      condition?: { type?: string };
    };
    if (!cfg.source_persona_id) return null;
    return {
      trigger: t,
      sourcePersonaId: cfg.source_persona_id,
      eventType: cfg.event_type || 'chain_triggered',
      conditionType: cfg.condition?.type || 'any',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// EventRow types (shared between UnifiedRoutingView and buildEventRows)
// ---------------------------------------------------------------------------

export type SourceClass = 'common' | 'persona' | 'external';

export interface SourcePersonaEntry {
  personaId: string;
  persona: Persona | undefined;
}

export interface Connection {
  kind: 'subscription' | 'chain' | 'trigger-listener';
  subscriptionId: string | null;
  triggerId: string | null;
  personaId: string;
  persona: Persona | undefined;
  /** Phase C4 — capability scope when the trigger is scoped to one use case. */
  useCaseId?: string | null;
  chainCondition?: string;
}

export interface EventRow {
  eventType: string;
  template: EventSourceTemplate | undefined;
  sourceClass: SourceClass;
  sourcePersonas: SourcePersonaEntry[];
  externalSourceLabels: string[];
  connections: Connection[];
}

// ---------------------------------------------------------------------------
// buildEventRows — pure derivation of EventRow[] from raw data.
//
// See the large comment block at the top of UnifiedRoutingView.tsx for the
// full explanation of the subscription-direction gap and inference heuristic.
// ---------------------------------------------------------------------------

export function buildEventRows(
  allTriggers: PersonaTrigger[],
  recentEvents: PersonaEvent[],
  subscriptions: PersonaEventSubscription[],
  personaMap: Map<string, Persona>,
): EventRow[] {
  const rowsByEvent = new Map<string, EventRow>();

  function ensureRow(eventType: string): EventRow {
    let row = rowsByEvent.get(eventType);
    if (!row) {
      const tmpl = findTemplateByEventType(eventType);
      row = {
        eventType,
        template: tmpl,
        sourceClass: tmpl ? 'common' : 'persona',
        sourcePersonas: [],
        externalSourceLabels: [],
        connections: [],
      };
      rowsByEvent.set(eventType, row);
    }
    return row;
  }

  function addSourcePersona(row: EventRow, personaId: string): void {
    if (row.sourcePersonas.some(s => s.personaId === personaId)) return;
    row.sourcePersonas.push({ personaId, persona: personaMap.get(personaId) });
    if (row.sourceClass !== 'common') row.sourceClass = 'persona';
  }

  function addExternalSource(row: EventRow, label: string): void {
    if (!label) return;
    if (row.externalSourceLabels.includes(label)) return;
    row.externalSourceLabels.push(label);
    if (row.sourcePersonas.length === 0 && row.sourceClass !== 'common') {
      row.sourceClass = 'external';
    }
  }

  // Step 1 — Catalog events (always visible as SYS rows even with no listeners)
  for (const cat of EVENT_SOURCE_CATEGORIES) {
    for (const tmpl of cat.templates) ensureRow(tmpl.eventType);
  }

  // Step 2 — Chain triggers: deterministic (source persona, chained target) tuples.
  const chainTriggers = allTriggers
    .map(parseChainTrigger)
    .filter((c): c is ChainTriggerView => c !== null);

  for (const c of chainTriggers) {
    const row = ensureRow(c.eventType);
    addSourcePersona(row, c.sourcePersonaId);
    if (c.trigger.persona_id !== c.sourcePersonaId) {
      if (!row.connections.some(x => x.personaId === c.trigger.persona_id && x.kind === 'chain')) {
        row.connections.push({
          kind: 'chain',
          subscriptionId: null,
          triggerId: c.trigger.id,
          personaId: c.trigger.persona_id,
          persona: personaMap.get(c.trigger.persona_id),
          chainCondition: c.conditionType,
        });
      }
    }
  }

  // Step 3 — Recent events: runtime ground truth for who has actually emitted what.
  const emittersByEventType = new Map<string, Set<string>>();
  for (const evt of recentEvents) {
    const emitterId = evt.source_id ?? null;
    const emitterIsPersona = emitterId ? personaMap.has(emitterId) : false;
    const row = ensureRow(evt.event_type);
    if (emitterIsPersona && emitterId) {
      addSourcePersona(row, emitterId);
      const set = emittersByEventType.get(evt.event_type) ?? new Set<string>();
      set.add(emitterId);
      emittersByEventType.set(evt.event_type, set);
    } else if (!row.template) {
      addExternalSource(row, evt.source_type || 'external');
    }
  }

  // Step 4 — Subscriptions with direction inference.
  function inferSubDirection(sub: PersonaEventSubscription): 'emitter' | 'listener' {
    if (findTemplateByEventType(sub.event_type)) return 'listener';
    const emitters = emittersByEventType.get(sub.event_type);
    if (emitters?.has(sub.persona_id)) return 'emitter';
    if (emitters && emitters.size > 0) return 'listener';
    return 'emitter';
  }

  for (const sub of subscriptions) {
    const direction = inferSubDirection(sub);
    const row = ensureRow(sub.event_type);
    if (direction === 'emitter') {
      addSourcePersona(row, sub.persona_id);
    } else {
      if (row.sourcePersonas.some(s => s.personaId === sub.persona_id)) continue;
      if (row.connections.some(c => c.personaId === sub.persona_id)) continue;
      row.connections.push({
        kind: 'subscription',
        subscriptionId: sub.id,
        triggerId: null,
        personaId: sub.persona_id,
        persona: personaMap.get(sub.persona_id),
      });
    }
  }

  // Step 5 — event_listener triggers — explicit listening intent.
  for (const t of allTriggers) {
    if (t.trigger_type !== 'event_listener' || !t.config) continue;
    try {
      const cfg = JSON.parse(t.config) as { listen_event_type?: string };
      const et = cfg.listen_event_type;
      if (!et) continue;
      const row = ensureRow(et);
      if (row.sourcePersonas.some(s => s.personaId === t.persona_id)) continue;
      // Phase C4: capability-scoped triggers are distinct connections even for
      // the same persona, so a persona can listen to the same event with two
      // different capabilities without the UI collapsing them.
      if (row.connections.some(c => c.personaId === t.persona_id && (c.useCaseId ?? null) === (t.use_case_id ?? null))) continue;
      row.connections.push({
        kind: 'trigger-listener',
        subscriptionId: null,
        triggerId: t.id,
        personaId: t.persona_id,
        persona: personaMap.get(t.persona_id),
        useCaseId: t.use_case_id,
      });
    } catch { /* skip */ }
  }

  // Final pass: drop dead-noise rows.
  for (const [, row] of rowsByEvent) {
    if (
      !row.template &&
      row.sourcePersonas.length === 0 &&
      row.externalSourceLabels.length === 0 &&
      row.connections.length === 0
    ) {
      rowsByEvent.delete(row.eventType);
    }
  }

  // Sort: content first, then USR > EXT > SYS, then by label.
  const classOrder: Record<SourceClass, number> = { persona: 0, external: 1, common: 2 };
  return Array.from(rowsByEvent.values()).sort((a, b) => {
    const aHas = a.connections.length + a.sourcePersonas.length > 0 ? 0 : 1;
    const bHas = b.connections.length + b.sourcePersonas.length > 0 ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    if (a.sourceClass !== b.sourceClass) return classOrder[a.sourceClass] - classOrder[b.sourceClass];
    return (a.template?.label ?? a.eventType).localeCompare(b.template?.label ?? b.eventType);
  });
}
