/**
 * Tauri event simulation for E2E tests.
 *
 * Overrides the default `listen` mock from setup.ts so that test code
 * can emit synthetic Tauri events and drive the full hook -> component pipeline.
 *
 * Usage:
 *   beforeEach(() => installTauriEventEmitter());
 *   afterEach(() => teardownTauriEventEmitter());
 *
 *   // inside a test:
 *   emitTauriEvent('execution-output', { execution_id: 'e1', line: 'hello' });
 */
import { vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';

type ListenHandler = Parameters<typeof listen>[1];
type ListenEvent = Parameters<ListenHandler>[0];

const registry = new Map<string, Set<ListenHandler>>();

/**
 * Install the event emitter. Call in `beforeEach` before rendering hooks/components.
 * Replaces the blanket `listen` mock from setup.ts with one that captures handlers.
 */
export function installTauriEventEmitter(): void {
  registry.clear();
  vi.mocked(listen).mockImplementation(
    async (eventName: string, handler: ListenHandler) => {
      if (!registry.has(eventName)) registry.set(eventName, new Set());
      registry.get(eventName)!.add(handler);
      return () => {
        registry.get(eventName)?.delete(handler);
      };
    },
  );
}

/**
 * Emit a synthetic Tauri event to all registered listeners for `eventName`.
 * Payload is wrapped in `{ payload }` to match Tauri's event shape.
 */
export function emitTauriEvent(eventName: string, payload: Record<string, unknown>): void {
  const handlers = registry.get(eventName);
  if (!handlers) return;
  const mockEvent = { event: eventName, id: 0, payload } as ListenEvent;
  for (const handler of handlers) {
    handler(mockEvent);
  }
}

/** Get the count of registered listeners for an event name. */
export function listenerCount(eventName: string): number {
  return registry.get(eventName)?.size ?? 0;
}

/** Tear down -- call in `afterEach`. */
export function teardownTauriEventEmitter(): void {
  registry.clear();
}
