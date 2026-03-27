/**
 * Centralized event type and status color tokens.
 *
 * Single source of truth for all event-related colors across the event bus,
 * canvas nodes, live stream badges, and particle visualizations.
 * Adding a new event type or status only requires updating this file.
 */

import type { StatusToken } from '@/lib/design/statusTokens';

// -- Event Type Colors ----------------------------------------------------

export interface EventTypeColor {
  /** Tailwind text color class, e.g. "text-blue-400" */
  tailwind: string;
  /** Raw hex color for SVG/canvas rendering */
  hex: string;
}

export const EVENT_TYPE_COLORS: Record<string, EventTypeColor> = {
  webhook_received:        { tailwind: 'text-blue-400',    hex: '#60a5fa' },
  execution_completed:     { tailwind: 'text-emerald-400', hex: '#34d399' },
  persona_action:          { tailwind: 'text-purple-400',  hex: '#a78bfa' },
  credential_event:        { tailwind: 'text-amber-400',   hex: '#fbbf24' },
  task_created:            { tailwind: 'text-cyan-400',    hex: '#22d3ee' },
  custom:                  { tailwind: 'text-primary',     hex: '#818cf8' },
  // Deployment lifecycle
  deploy_started:          { tailwind: 'text-sky-400',     hex: '#38bdf8' },
  deploy_succeeded:        { tailwind: 'text-green-400',   hex: '#4ade80' },
  deploy_failed:           { tailwind: 'text-red-400',     hex: '#f87171' },
  deploy_paused:           { tailwind: 'text-orange-400',  hex: '#fb923c' },
  deploy_resumed:          { tailwind: 'text-teal-400',    hex: '#2dd4bf' },
  agent_undeployed:        { tailwind: 'text-rose-400',    hex: '#fb7185' },
  credential_provisioned:  { tailwind: 'text-yellow-400',  hex: '#facc15' },
  // Mock/test/seed events
  trigger_fired:           { tailwind: 'text-indigo-400',  hex: '#818cf8' },
  credential_rotated:      { tailwind: 'text-amber-400',   hex: '#fbbf24' },
  health_check_failed:     { tailwind: 'text-red-400',     hex: '#f87171' },
  deployment_started:      { tailwind: 'text-sky-400',     hex: '#38bdf8' },
  memory_created:          { tailwind: 'text-violet-400',  hex: '#a78bfa' },
  review_submitted:        { tailwind: 'text-teal-400',    hex: '#2dd4bf' },
  test_event:              { tailwind: 'text-gray-400',    hex: '#9ca3af' },
  chain_triggered:         { tailwind: 'text-indigo-400',  hex: '#818cf8' },
};

/** Fallback color for unknown event types */
export const EVENT_TYPE_FALLBACK: EventTypeColor = {
  tailwind: 'text-gray-400',
  hex: '#9ca3af',
};

/** Get event type color with fallback for unknown types */
export function getEventTypeColor(eventType: string): EventTypeColor {
  return EVENT_TYPE_COLORS[eventType] ?? EVENT_TYPE_FALLBACK;
}

/** Pre-built hex color record for SVG/canvas consumers */
export const EVENT_TYPE_HEX_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_TYPE_COLORS).map(([k, v]) => [k, v.hex]),
);

// -- Event Status Colors --------------------------------------------------

/** Subset of StatusToken used for event status indicators. */
export type EventStatusColor = Pick<StatusToken, 'bg' | 'text' | 'border'>;

export const EVENT_STATUS_COLORS: Record<string, EventStatusColor> = {
  pending:     { bg: 'bg-status-pending/10',    text: 'text-status-pending',    border: 'border-status-pending/20' },
  processing:  { bg: 'bg-status-processing/10', text: 'text-status-processing', border: 'border-status-processing/20' },
  delivered:   { bg: 'bg-status-success/10',    text: 'text-status-success',    border: 'border-status-success/20' },
  completed:   { bg: 'bg-status-success/10',    text: 'text-status-success',    border: 'border-status-success/20' },
  failed:      { bg: 'bg-status-error/10',      text: 'text-status-error',      border: 'border-status-error/20' },
  skipped:     { bg: 'bg-status-neutral/10',    text: 'text-status-neutral',    border: 'border-status-neutral/20' },
  dead_letter: { bg: 'bg-status-error/10',      text: 'text-status-error',      border: 'border-status-error/20' },
  discarded:   { bg: 'bg-status-neutral/10',    text: 'text-status-neutral',    border: 'border-status-neutral/20' },
};

/** Fallback status color for unknown statuses */
export const EVENT_STATUS_FALLBACK: EventStatusColor = {
  bg: 'bg-gray-500/10',
  text: 'text-gray-400',
  border: 'border-gray-500/20',
};

/** Get event status color with fallback for unknown statuses */
export function getEventStatusColor(status: string): EventStatusColor {
  return EVENT_STATUS_COLORS[status] ?? EVENT_STATUS_FALLBACK;
}

// -- Combined hook-style accessor -----------------------------------------

export interface EventColorResult {
  /** Type color classes */
  type: EventTypeColor;
  /** Status color classes */
  status: EventStatusColor;
  /** Hex color for SVG particles */
  hex: string;
}

/** Get consistent color set for an event given its type and status */
export function getEventColor(eventType: string, status: string): EventColorResult {
  const type = getEventTypeColor(eventType);
  const statusColor = getEventStatusColor(status);
  return { type, status: statusColor, hex: type.hex };
}
