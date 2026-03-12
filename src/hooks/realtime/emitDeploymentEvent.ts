/**
 * Emits synthetic deployment lifecycle events into the event bus subscriber
 * system so they appear in the EventBusVisualization and timeline replay.
 *
 * These events are emitted client-side (not from the Tauri backend) because
 * deployment actions originate from frontend store slices (cloudSlice,
 * gitlabSlice). The singleton subscriber set in useEventBusListener fans
 * them out to all active listeners just like backend events.
 */

import { emit } from '@tauri-apps/api/event';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';

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
  status?: 'completed' | 'failed' | 'pending';
}

/**
 * Emit a deployment event through the Tauri event bus so it is picked up
 * by useEventBusListener subscribers (EventBusVisualization, timeline, etc).
 */
export function emitDeploymentEvent(opts: EmitOptions): void {
  const event: PersonaEvent = {
    id: `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    project_id: 'system',
    event_type: opts.eventType,
    source_type: 'deployment',
    source_id: opts.target,
    target_persona_id: opts.personaId ?? null,
    payload: opts.detail ? JSON.stringify({ detail: opts.detail, target: opts.target }) : null,
    status: opts.status ?? 'completed',
    error_message: null,
    processed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    use_case_id: null,
  };

  // Emit through Tauri's event system -- the singleton listener picks it up
  emit('event-bus', event).catch(() => {
    // If Tauri emit fails (e.g. in tests), silently ignore
  });
}
