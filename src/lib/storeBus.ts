/**
 * StoreBus — lightweight typed event bus for inter-store communication.
 *
 * Replaces direct `useXStore.getState()` calls between domain stores with two
 * explicit, traceable mechanisms:
 *
 *  • **Events** (`emit` / `on`) — fire-and-forget notifications (toasts,
 *    refresh triggers, navigation side-effects).
 *  • **Accessors** (`provide` / `get`) — synchronous cross-domain data reads
 *    routed through named keys instead of direct store imports.
 *
 * All cross-store dependencies are declared in {@link StoreBusEventMap} and
 * wired centrally in `storeBusWiring.ts`, making the dependency graph visible
 * and each relationship independently testable.
 */

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

export interface StoreBusEventMap {
  /** Display a toast notification (toastStore subscribes). */
  'toast': { message: string; type: 'success' | 'error'; duration?: number };

  /** An execution finished (systemStore subscribes for tour events). */
  'execution:completed': { personaId: string };

  /** User selected/deselected a persona (systemStore subscribes for nav state). */
  'persona:selected': { personaId: string | null };

  /** Bundle import / share-link import finished (agentStore subscribes to refresh personas). */
  'network:personas-changed': undefined;

  /** A trigger was created / updated / deleted (agentStore subscribes to refresh detail). */
  'trigger:changed': { personaId: string };

  /** Move a persona into a group (agentStore subscribes to apply the operation). */
  'persona:move-to-group': { personaId: string; groupId: string | null };
}

// ---------------------------------------------------------------------------
// Accessor key constants (grep-friendly)
// ---------------------------------------------------------------------------

export const AccessorKey = {
  AGENTS_PERSONAS: 'agents:personas',
  AGENTS_SELECTED_PERSONA_ID: 'agents:selectedPersonaId',
  SYSTEM_CLOUD_CONFIG: 'system:cloudConfig',
  VAULT_CREDENTIALS: 'vault:credentials',
  AUTH_IS_AUTHENTICATED: 'auth:isAuthenticated',
} as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type Handler = (...args: never[]) => void;

const _listeners = new Map<string, Set<Handler>>();
const _accessors = new Map<string, () => unknown>();

function emit<K extends keyof StoreBusEventMap>(
  event: K,
  ...[payload]: StoreBusEventMap[K] extends undefined ? [] : [StoreBusEventMap[K]]
): void {
  const set = _listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      (fn as (p: StoreBusEventMap[K]) => void)(payload!);
    } catch (e) {
      console.error(`[storeBus] handler error for "${event}"`, e);
    }
  }
}

function on<K extends keyof StoreBusEventMap>(
  event: K,
  handler: StoreBusEventMap[K] extends undefined ? () => void : (payload: StoreBusEventMap[K]) => void,
): () => void {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event)!.add(handler as Handler);
  return () => {
    _listeners.get(event)?.delete(handler as Handler);
  };
}

/** Register a cross-domain data accessor. */
function provide(key: string, resolver: () => unknown): void {
  _accessors.set(key, resolver);
}

/** Read cross-domain data through a named accessor. */
function get<T>(key: string): T {
  const resolver = _accessors.get(key);
  if (!resolver) throw new Error(`[storeBus] no accessor registered for "${key}"`);
  return resolver() as T;
}

/** Remove all listeners and accessors (for tests / hot-reload). */
function _reset(): void {
  _listeners.clear();
  _accessors.clear();
}

export const storeBus = { emit, on, provide, get, _reset } as const;
