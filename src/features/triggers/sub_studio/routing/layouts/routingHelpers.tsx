/**
 * Shared helpers + types for the routing view tree.
 *
 * This file contains small pure helpers (icon resolution) and the row-model
 * types consumed across ./routing/. Trigger configs are decoded into routes by
 * ../../libs/routeCodec, never here.
 *
 * The larger buildEventRows() derivation lives in a sibling file
 * (./buildEventRows.ts) to keep each file under the LOC budget; it's
 * re-exported from here so existing call-sites (e.g. useRoutingState)
 * keep their import path stable.
 */
import { Zap, type LucideIcon, Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow, Layers, FileEdit, CheckCircle2, XCircle, Store } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { EventSourceTemplate } from '@/features/triggers/lib/eventSourceTemplates';
import type { LiveRoute } from '../../libs/routeCodec';

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

// ── Row types (consumed by ./routing/ and useRoutingState) ──────────────

export type SourceClass = 'common' | 'persona' | 'external';

export interface SourcePersonaEntry {
  personaId: string;
  persona: Persona | undefined;
}

export interface Connection {
  /**
   * `subscription` = a legacy persona_event_subscriptions row; `chain` = a
   * persona-completion route; `signal` = a signal-source trigger route
   * (schedule, webhook, file_watcher, ...); `trigger-listener` = an
   * event_listener route (user listener or Marketplace feed).
   */
  kind: 'subscription' | 'chain' | 'signal' | 'trigger-listener';
  subscriptionId: string | null;
  triggerId: string | null;
  personaId: string;
  persona: Persona | undefined;
  /** Phase C4 — capability scope when the trigger is scoped to one use case. */
  useCaseId?: string | null;
  /**
   * The decoded route for every trigger-backed connection (routeCodec): its
   * true source, condition, and the trigger that governs it. Chains all share
   * the `chain_triggered` row and signal routes the `trigger_fired` row, so the
   * per-edge source lives here, not on the row.
   */
  route?: LiveRoute;
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
