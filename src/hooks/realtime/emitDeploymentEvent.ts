/**
 * Emits synthetic deployment lifecycle events into the event bus subscriber
 * system so they appear in the EventBusVisualization and timeline replay.
 *
 * These events are emitted client-side (not from the Tauri backend) because
 * deployment actions originate from frontend store slices (cloudSlice,
 * gitlabSlice). The singleton subscriber set in useEventBusListener fans
 * them out to all active listeners just like backend events.
 *
 * THEY ARE LOCAL-ONLY AND NOT DURABLE. Nothing persists them — there is no
 * Tauri command a frontend caller can use to write a `persona_events` row — so
 * a deploy event lives only in the current session's in-memory buffers and is
 * gone on reload.
 *
 * Because of that they carry NO server-assigned ordering key, and `created_at`
 * is deliberately left EMPTY rather than minted from `new Date()`. Ranking a
 * renderer-clock timestamp against database rows written by another clock puts
 * the row at an arbitrary point in a totally-ordered stream — the condition the
 * `feed-item-ordered-by-the-renderers-clock` census rule names, whose golden
 * path is docs/concepts/golden-paths/chronological-feed.md. The rule's legal
 * fixes are (a) echo the server key back on confirm, which needs a persisted
 * row this event never gets, or (b) render the item OUTSIDE the ranked list
 * until it has one. This takes (b): consumers rank only rows with a parseable
 * `created_at` and pin the keyless ones at the live end of the feed.
 *
 * When the client's own observation time is genuinely wanted (a detail panel,
 * a debug view) it rides in the payload as `observed_at`, where nothing ranks
 * on it.
 */

import { emit } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventStatus } from '@/lib/bindings/PersonaEventStatus';
import { silentCatch } from '@/lib/silentCatch';

export type DeploymentEventType =
  | 'deploy_started'
  | 'deploy_succeeded'
  | 'deploy_failed'
  | 'deploy_paused'
  | 'deploy_resumed'
  | 'agent_undeployed'
  | 'credential_provisioned';

export type DeploymentTarget = 'cloud' | 'gitlab';

interface EmitOptions {
  eventType: DeploymentEventType;
  target: DeploymentTarget;
  personaId?: string | null;
  /** Extra context (deployment ID, project name, etc.) */
  detail?: string;
  status?: PersonaEventStatus;
}

/**
 * Emit a deployment event through the Tauri event bus so it is picked up
 * by useEventBusListener subscribers (EventBusVisualization, timeline, etc).
 */
export function emitDeploymentEvent(opts: EmitOptions): void {
  // The renderer's observation time — carried in the payload blob, which no
  // feed ranks on, never in an ordering field.
  const observedAt = new Date().toISOString();

  const event: PersonaEvent = {
    id: `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    project_id: 'system',
    event_type: opts.eventType,
    source_type: 'deployment',
    source_id: opts.target,
    target_persona_id: opts.personaId ?? null,
    payload: JSON.stringify({
      ...(opts.detail ? { detail: opts.detail } : {}),
      target: opts.target,
      local_only: true,
      observed_at: observedAt,
    }),
    status: opts.status ?? 'completed',
    error_message: null,
    // Never processed by the backend — this row was never written there.
    processed_at: null,
    // EMPTY ON PURPOSE: no server-assigned ordering key. See the docblock.
    created_at: '',
    use_case_id: null,
    retry_count: 0,
  };

  // Emit through Tauri's event system -- the singleton listener picks it up
  emit(EventName.EVENT_BUS, event).catch(silentCatch('hooks/realtime/emitDeploymentEvent:emitDeploymentEvent'));
}
