/**
 * Notification Middleware
 *
 * Emits execution lifecycle events via storeBus so other subsystems
 * (guided tour, mini-player, onboarding) can react without coupling
 * to the execution slice.
 *
 * Stage: frontend_complete
 */

import { addMiddleware, type PipelineMiddleware } from '@/lib/execution/pipeline';
import { storeBus } from '@/lib/storeBus';

const notificationMiddleware: PipelineMiddleware<'frontend_complete'> = (
  _stage,
  payload,
  _trace,
) => {
  storeBus.emit('execution:completed', { personaId: payload.personaId ?? '' });
  return payload;
};

export function registerNotificationMiddleware(): void {
  addMiddleware('frontend_complete', { key: 'notification', priority: 10 }, notificationMiddleware);
}
