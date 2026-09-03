/**
 * System Trace -- structured span-based tracing for all non-execution
 * system operations (design conversations, credential flows, template
 * adoption, subscription evaluation, etc.).
 *
 * Reuses the same `UnifiedSpan` shape from the execution pipeline so
 * that the TraceInspector / SystemTraceViewer can render both execution
 * and system traces with one component tree.
 *
 * ## Usage
 *
 * ```ts
 * const trace = SystemTraceSession.start('credential_design', 'Design: Stripe');
 * const spanId = trace.beginSpan('credential_design', 'AI Analysis');
 * // ... do work ...
 * trace.endSpan(spanId);
 * trace.complete();
 * // trace.trace is the finished UnifiedTrace
 * ```
 */

import { silentCatch } from '@/lib/silentCatch';
import type { UnifiedSpan, UnifiedSpanType, SystemOperationType } from './pipeline';

// =============================================================================
// System trace types
// =============================================================================

export interface SystemTrace {
  traceId: string;
  operationType: SystemOperationType;
  label: string;
  spans: UnifiedSpan[];
  startedAt: number;
  completedAt?: number;
  /**
   * The session was never completed by its owner — it went quiet past the
   * active-session TTL (or was evicted at the cap) and the registry closed it.
   * Distinct from an error: nothing failed, nobody finished it.
   */
  abandoned?: boolean;
}

// =============================================================================
// ID generation
// =============================================================================

let _sysSpanCounter = 0;

function generateSpanId(prefix: string): string {
  return `sys-${prefix}-${++_sysSpanCounter}-${Date.now().toString(36)}`;
}

function generateTraceId(): string {
  return `systrace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// SystemTraceSession -- mutable session that accumulates spans
// =============================================================================

export class SystemTraceSession {
  readonly traceId: string;
  readonly operationType: SystemOperationType;
  readonly label: string;
  readonly startedAt: number;

  private _spans: UnifiedSpan[] = [];
  private _completedAt?: number;
  private _abandoned = false;
  /** Wall clock of the last span activity — what the TTL sweep ages against. */
  private _lastActivityAt: number;

  private constructor(operationType: SystemOperationType, label: string) {
    this.traceId = generateTraceId();
    this.operationType = operationType;
    this.label = label;
    this.startedAt = Date.now();
    this._lastActivityAt = this.startedAt;
  }

  static start(operationType: SystemOperationType, label: string): SystemTraceSession {
    const session = new SystemTraceSession(operationType, label);

    // Create root span for the overall operation
    const rootSpan: UnifiedSpan = {
      span_id: generateSpanId(operationType),
      parent_span_id: null,
      span_type: operationType,
      name: label,
      start_ms: 0,
      end_ms: null,
      duration_ms: null,
      cost_usd: null,
      error: null,
      metadata: null,
    };
    session._spans.push(rootSpan);

    // Register in active sessions. Sweep first so a burst of starts can never
    // grow the map past its cap with sessions nobody will ever complete.
    sweepAbandonedSessions();
    _activeSessions.set(session.traceId, session);
    enforceActiveSessionCap();
    notifySystemTraceChange();

    return session;
  }

  get rootSpanId(): string {
    return this._spans[0]?.span_id ?? '';
  }

  get spans(): readonly UnifiedSpan[] {
    return this._spans;
  }

  get isComplete(): boolean {
    return this._completedAt !== undefined;
  }

  /** Wall clock of the last span activity on this session. */
  get lastActivityAt(): number {
    return this._lastActivityAt;
  }

  /** Start a child span under the root (or a specified parent). */
  beginSpan(
    spanType: UnifiedSpanType,
    name: string,
    parentSpanId?: string,
    metadata?: Record<string, unknown>,
  ): string {
    const id = generateSpanId(String(spanType));
    const relativeMs = Date.now() - this.startedAt;

    const span: UnifiedSpan = {
      span_id: id,
      parent_span_id: parentSpanId ?? this.rootSpanId,
      span_type: spanType,
      name,
      start_ms: relativeMs,
      end_ms: null,
      duration_ms: null,
      cost_usd: null,
      error: null,
      metadata: metadata ?? null,
    };

    this._spans.push(span);
    this._lastActivityAt = Date.now();
    notifySystemTraceChange();
    return id;
  }

  /** End a specific span (sets end_ms and duration_ms). */
  endSpan(spanId: string, error?: string, costUsd?: number): void {
    const relativeMs = Date.now() - this.startedAt;
    this._spans = this._spans.map((s) => {
      if (s.span_id === spanId && s.end_ms === null) {
        return {
          ...s,
          end_ms: relativeMs,
          duration_ms: relativeMs - s.start_ms,
          error: error ?? s.error,
          cost_usd: costUsd ?? s.cost_usd,
        };
      }
      return s;
    });
    this._lastActivityAt = Date.now();
    notifySystemTraceChange();
  }

  /** Mark the session and all open spans as complete. */
  complete(error?: string): SystemTrace {
    return this._finish(error, false);
  }

  /**
   * Close a session nobody finished -- the owner unmounted, or the TTL sweep
   * reached it. The trace is kept (it is real work that happened) but it stops
   * counting as active, and it carries no error, because nothing failed.
   */
  abandon(): SystemTrace {
    return this._finish(undefined, true);
  }

  private _finish(error: string | undefined, abandoned: boolean): SystemTrace {
    // Completing twice would push the same trace into the ring a second time.
    if (this._completedAt !== undefined) return this.toTrace();

    const relativeMs = Date.now() - this.startedAt;
    this._completedAt = Date.now();
    this._lastActivityAt = this._completedAt;
    this._abandoned = abandoned;

    this._spans = this._spans.map((s) => {
      if (s.end_ms === null) {
        return {
          ...s,
          end_ms: relativeMs,
          duration_ms: relativeMs - s.start_ms,
          error: s.span_id === this.rootSpanId ? (error ?? s.error) : s.error,
        };
      }
      return s;
    });

    // Move to completed, remove from active
    _activeSessions.delete(this.traceId);
    const trace = this.toTrace();
    _completedTraces.push(trace);
    if (_completedTraces.length > MAX_COMPLETED_TRACES) {
      _completedTraces.shift();
    }
    notifySystemTraceChange();

    return trace;
  }

  /** Convert to a snapshot SystemTrace. */
  toTrace(): SystemTrace {
    return {
      traceId: this.traceId,
      operationType: this.operationType,
      label: this.label,
      spans: [...this._spans],
      startedAt: this.startedAt,
      completedAt: this._completedAt,
      abandoned: this._abandoned ? true : undefined,
    };
  }
}

// =============================================================================
// Global trace registry (in-memory, session-scoped)
// =============================================================================

const MAX_COMPLETED_TRACES = 100;

/**
 * A session with no span activity for this long is assumed abandoned: its
 * owner unmounted, navigated away or crashed without calling `complete()`.
 * Ten minutes is comfortably longer than any traced operation the app
 * performs (the longest, a design conversation, is bounded by the AI task's
 * own timeout) and short enough that a phantom "N active" badge on the
 * Observability trace panel corrects itself within one work break.
 */
const ACTIVE_SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * Hard ceiling on concurrent active sessions. `_completedTraces` has always
 * been capped at 100; `_activeSessions` was uncapped, so any leak — a caller
 * that never completes, a re-render loop that starts one per pass — grew a Map
 * that is read on every notify, for the life of the app session. When the cap
 * is exceeded the OLDEST-by-activity session is abandoned, because a session
 * that has gone longest without a span is the least likely to still be real.
 */
const MAX_ACTIVE_SESSIONS = 50;

const _activeSessions = new Map<string, SystemTraceSession>();
const _completedTraces: SystemTrace[] = [];

/**
 * One mutable slot used to live here, and `onSystemTraceChange` overwrote it.
 * A second `useSystemTraces()` mount therefore silently stole updates from the
 * first — and its unsubscribe cleared the slot for everyone. `useSyncExternalStore`
 * assumes N independent subscribers, so this is a Set and each unsubscribe
 * removes only its own callback.
 */
const _listeners = new Set<() => void>();

/** Notify every subscriber. One throwing listener must not starve the rest. */
function notifySystemTraceChange(): void {
  for (const listener of [..._listeners]) {
    try {
      listener();
    } catch (err) {
      silentCatch('lib/execution/systemTrace:notify')(err);
    }
  }
}

/**
 * Close sessions that have gone quiet past the TTL. Deliberately silent: it
 * runs from reads as well as writes, and notifying from a read would re-enter
 * the subscribers that are mid-read.
 */
function sweepAbandonedSessions(now: number = Date.now()): void {
  for (const session of [..._activeSessions.values()]) {
    if (now - session.lastActivityAt > ACTIVE_SESSION_TTL_MS) {
      session.abandon();
    }
  }
}

/** Evict the least recently active sessions down to the cap. */
function enforceActiveSessionCap(): void {
  if (_activeSessions.size <= MAX_ACTIVE_SESSIONS) return;
  const byActivity = [..._activeSessions.values()].sort(
    (a, b) => a.lastActivityAt - b.lastActivityAt,
  );
  for (const session of byActivity.slice(0, _activeSessions.size - MAX_ACTIVE_SESSIONS)) {
    session.abandon();
  }
}

/** Subscribe to session changes for reactive UI updates. */
export function onSystemTraceChange(callback: () => void): () => void {
  _listeners.add(callback);
  return () => {
    _listeners.delete(callback);
  };
}

/** Get all active (in-progress) system trace sessions. */
export function getActiveSessions(): SystemTraceSession[] {
  sweepAbandonedSessions();
  return Array.from(_activeSessions.values());
}

/** Get completed system traces (most recent first). */
export function getCompletedTraces(): SystemTrace[] {
  sweepAbandonedSessions();
  return [..._completedTraces].reverse();
}

/** Get all traces (active + completed) for display. */
export function getAllSystemTraces(): SystemTrace[] {
  sweepAbandonedSessions();
  const active = Array.from(_activeSessions.values()).map((s) => s.toTrace());
  return [...active, ...[..._completedTraces].reverse()];
}

/** Clear all completed traces. */
export function clearCompletedTraces(): void {
  _completedTraces.length = 0;
  notifySystemTraceChange();
}

/**
 * Test hatch for this module-scope singleton (see
 * `docs/concepts/golden-paths/hmr-safe-singletons.md`). Drops every active
 * session and every completed trace. Subscribers are deliberately KEPT: they
 * belong to mounted components, not to this module, and dropping them would
 * leave a live `useSyncExternalStore` permanently deaf.
 */
export function __resetSystemTracesForTests(): void {
  _activeSessions.clear();
  _completedTraces.length = 0;
  notifySystemTraceChange();
}

// =============================================================================
// Convenience: wrap an async operation in a traced span
// =============================================================================

/**
 * Execute an async function wrapped in a system trace span.
 *
 * ```ts
 * const result = await tracedOperation(
 *   'credential_design',
 *   'Design: Stripe API key',
 *   async (session) => {
 *     const spanId = session.beginSpan('credential_design', 'AI Analysis');
 *     const result = await analyzeCredential();
 *     session.endSpan(spanId);
 *     return result;
 *   },
 * );
 * ```
 */
export async function tracedOperation<T>(
  operationType: SystemOperationType,
  label: string,
  fn: (session: SystemTraceSession) => Promise<T>,
): Promise<T> {
  const session = SystemTraceSession.start(operationType, label);
  try {
    const result = await fn(session);
    session.complete();
    return result;
  } catch (err) {
    session.complete(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
