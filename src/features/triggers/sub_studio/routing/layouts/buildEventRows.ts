/**
 * buildEventRows — pure derivation of the routing view's row model from the
 * raw backend data (triggers + recent events + subscriptions + persona map).
 *
 * Trigger-backed connections are NOT inferred here: they come from the route
 * codec (../../libs/routeCodec), the tested inverse of what the Studio writes,
 * so there is exactly one cable per committed route. This file keeps the
 * event-row job: catalog rows, persona emitters, legacy subscriptions.
 */
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { EVENT_SOURCE_CATEGORIES, findTemplateByEventType } from '@/features/triggers/lib/eventSourceTemplates';
import { isListenerRoute, triggersToRoutes, type LiveRoute } from '../../libs/routeCodec';
import type { Connection, EventRow, SourceClass } from './routingHelpers';


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

  function addRoute(row: EventRow, route: LiveRoute, kind: Connection['kind']): void {
    row.connections.push({
      kind,
      subscriptionId: null,
      triggerId: route.primaryTriggerId,
      personaId: route.targetPersonaId,
      persona: personaMap.get(route.targetPersonaId),
      useCaseId: route.useCaseId,
      route,
    });
  }

  const routes = triggersToRoutes(allTriggers);

  // Step 2 — Chain routes: deterministic (source persona, target) tuples. One
  // cable per chain trigger, so A→B and C→B (or two conditions on A→B) stay
  // distinct; a self-chain is not drawn.
  for (const route of routes) {
    if (route.source.kind !== 'persona') continue;
    const row = ensureRow(route.eventType);
    addSourcePersona(row, route.source.personaId);
    if (route.targetPersonaId !== route.source.personaId) addRoute(row, route, 'chain');
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

  // Step 5 — every other committed route: listeners (user listeners and
  // Marketplace feeds) and signal sources. Auto-listeners were folded into their
  // source trigger by the codec, so N schedules into one persona are N cables.
  for (const route of routes) {
    if (route.source.kind === 'persona') continue;
    addRoute(ensureRow(route.eventType), route, isListenerRoute(route) ? 'trigger-listener' : 'signal');
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
