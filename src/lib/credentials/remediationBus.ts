/**
 * Credential Remediation Event Bus
 *
 * Connects anomaly signal producers (healthchecks, anomaly scoring, rotation status)
 * to executable remediation consumers (auto-rotate, auto-disable, notify).
 *
 * Architecture:
 *   Signal → RemediationEvent → Bus → ActionExecutor → Side effects
 *
 * The bus provides deduplication (same credential + same action won't fire twice
 * within a cooldown window), an action log for UI, and subscriber notification.
 */

import type { Remediation, AnomalyScore } from '@/api/rotation';

// ── Event Types ─────────────────────────────────────────────────────

export type RemediationAction =
  | 'auto_rotate'
  | 'auto_disable'
  | 'notify_drift'
  | 'notify_degraded'
  | 'notify_critical'
  | 'backoff';

export interface RemediationEvent {
  id: string;
  credentialId: string;
  credentialName: string;
  action: RemediationAction;
  remediation: Remediation;
  /** What triggered this event */
  reason: string;
  /** Anomaly score at time of event */
  anomalyScore: AnomalyScore | null;
  timestamp: string;
  /** Result after action execution */
  outcome: 'pending' | 'success' | 'failed' | 'skipped';
  outcomeDetail?: string;
}

// ── Remediation → Action Mapping ────────────────────────────────────

/**
 * Map a remediation level to the set of actions that should be taken.
 * Multiple actions can fire for a single remediation (e.g., rotate + notify).
 */
export function actionsForRemediation(remediation: Remediation): RemediationAction[] {
  switch (remediation) {
    case 'healthy':
      return [];
    case 'backoff_retry':
      return ['backoff', 'notify_degraded'];
    case 'preemptive_rotation':
      return ['auto_rotate', 'notify_degraded'];
    case 'rotate_then_alert':
      return ['auto_rotate', 'notify_critical'];
    case 'disable':
      return ['auto_disable', 'notify_critical'];
  }
}

// ── Deduplication ───────────────────────────────────────────────────

/** Default cooldown: don't repeat the same action for the same credential within this window. */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Cooldown overrides per action type */
const ACTION_COOLDOWNS: Partial<Record<RemediationAction, number>> = {
  auto_rotate: 15 * 60 * 1000,    // 15 min between rotation attempts
  auto_disable: 30 * 60 * 1000,   // 30 min between disable attempts
  notify_critical: 10 * 60 * 1000, // 10 min between critical notifications
};

function cooldownKey(credentialId: string, action: RemediationAction): string {
  return `${credentialId}:${action}`;
}

// ── Bus Implementation ──────────────────────────────────────────────

type BusSubscriber = (event: RemediationEvent) => void;

const MAX_LOG_SIZE = 100;

class RemediationBusImpl {
  private subscribers = new Set<BusSubscriber>();
  private cooldowns = new Map<string, number>(); // key → expiry timestamp
  private _log: RemediationEvent[] = [];

  /** Subscribe to remediation events. Returns unsubscribe function. */
  subscribe(fn: BusSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Read-only access to the event log. */
  get log(): readonly RemediationEvent[] {
    return this._log;
  }

  /** Clear expired cooldowns. Called lazily before checking. */
  private cleanCooldowns() {
    const now = Date.now();
    for (const [key, expiry] of this.cooldowns) {
      if (expiry <= now) this.cooldowns.delete(key);
    }
  }

  /** Check if an action is currently on cooldown for a credential. */
  isOnCooldown(credentialId: string, action: RemediationAction): boolean {
    this.cleanCooldowns();
    const key = cooldownKey(credentialId, action);
    return this.cooldowns.has(key);
  }

  /**
   * Dispatch a remediation event.
   * Returns false if the event was deduplicated (on cooldown).
   */
  dispatch(event: Omit<RemediationEvent, 'id' | 'timestamp' | 'outcome'>): RemediationEvent | null {
    const key = cooldownKey(event.credentialId, event.action);

    // Dedup check
    this.cleanCooldowns();
    if (this.cooldowns.has(key)) {
      return null;
    }

    const fullEvent: RemediationEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      outcome: 'pending',
    };

    // Set cooldown
    const cooldownMs = ACTION_COOLDOWNS[event.action] ?? DEFAULT_COOLDOWN_MS;
    this.cooldowns.set(key, Date.now() + cooldownMs);

    // Log
    this._log.unshift(fullEvent);
    if (this._log.length > MAX_LOG_SIZE) this._log.length = MAX_LOG_SIZE;

    // Notify subscribers
    for (const sub of this.subscribers) {
      try { sub(fullEvent); } catch { /* subscriber error doesn't break bus */ }
    }

    return fullEvent;
  }

  /** Update the outcome of a previously dispatched event. */
  updateOutcome(eventId: string, outcome: RemediationEvent['outcome'], detail?: string) {
    const event = this._log.find((e) => e.id === eventId);
    if (event) {
      event.outcome = outcome;
      if (detail) event.outcomeDetail = detail;
    }
  }

  /** Reset all cooldowns (e.g., when user manually triggers re-evaluation). */
  resetCooldowns() {
    this.cooldowns.clear();
  }

  /** Clear the full log. */
  clearLog() {
    this._log.length = 0;
  }
}

/** Singleton remediation bus instance. */
export const remediationBus = new RemediationBusImpl();
