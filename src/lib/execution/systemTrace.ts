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

  private constructor(operationType: SystemOperationType, label: string) {
    this.traceId = generateTraceId();
    this.operationType = operationType;
    this.label = label;
    this.startedAt = Date.now();
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

    // Register in active sessions
    _activeSessions.set(session.traceId, session);
    _onSessionChange?.();

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
    _onSessionChange?.();
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
    _onSessionChange?.();
  }

  /** Mark the session and all open spans as complete. */
  complete(error?: string): SystemTrace {
    const relativeMs = Date.now() - this.startedAt;
    this._completedAt = Date.now();

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
    _onSessionChange?.();

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
    };
  }
}

// =============================================================================
// Global trace registry (in-memory, session-scoped)
// =============================================================================

const MAX_COMPLETED_TRACES = 100;

const _activeSessions = new Map<string, SystemTraceSession>();
const _completedTraces: SystemTrace[] = [];
let _onSessionChange: (() => void) | undefined;

/** Subscribe to session changes for reactive UI updates. */
export function onSystemTraceChange(callback: () => void): () => void {
  _onSessionChange = callback;
  return () => {
    if (_onSessionChange === callback) _onSessionChange = undefined;
  };
}

/** Get all active (in-progress) system trace sessions. */
export function getActiveSessions(): SystemTraceSession[] {
  return Array.from(_activeSessions.values());
}

/** Get completed system traces (most recent first). */
export function getCompletedTraces(): SystemTrace[] {
  return [..._completedTraces].reverse();
}

/** Get all traces (active + completed) for display. */
export function getAllSystemTraces(): SystemTrace[] {
  const active = Array.from(_activeSessions.values()).map((s) => s.toTrace());
  return [...active, ...[..._completedTraces].reverse()];
}

/** Clear all completed traces. */
export function clearCompletedTraces(): void {
  _completedTraces.length = 0;
  _onSessionChange?.();
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
