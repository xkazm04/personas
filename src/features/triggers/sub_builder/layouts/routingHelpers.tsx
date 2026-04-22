/**
 * Shared helpers + types for the routing view tree.
 *
 * This file contains small pure helpers (icon resolution, chain-trigger
 * parsing) and the row-model types consumed across ./routing/.
 *
 * The larger buildEventRows() derivation lives in a sibling file
 * (./buildEventRows.ts) to keep each file under the LOC budget; it's
 * re-exported from here so existing call-sites (e.g. useRoutingState)
 * keep their import path stable.
 */
import { Zap, type LucideIcon, Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow, Layers, FileEdit, CheckCircle2, XCircle, Store } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { EventSourceTemplate } from '../libs/eventCanvasConstants';

// ── Icon resolution ─────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
};

export function resolveIcon(tmpl: EventSourceTemplate | undefined): LucideIcon {
  if (!tmpl) return Zap;
  const name = tmpl.icon?.displayName;
  return name ? (ICON_MAP[name] ?? Zap) : Zap;
}

// ── Chain trigger parsing ───────────────────────────────────────────────

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

// ── Row types (consumed by ./routing/ and useRoutingState) ──────────────

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

// Re-export so consumers can keep importing `buildEventRows` from the
// established path — see ./buildEventRows.ts for the implementation.
export { buildEventRows } from './buildEventRows';
