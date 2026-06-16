/**
 * Activation funnel — the conversion events a growth funnel is built from.
 *
 * The nav-tracking layer answers "which screens get used"; this answers the
 * questions growth actually runs on: did a new install reach value, how fast,
 * and did value beget sharing (the K-factor). Each milestone fires AT MOST ONCE
 * per install (persisted dedupe) and flows through the same pluggable sink as
 * the rest of analytics — so it auto-respects the telemetry toggle (the active
 * sink is `noopSink` when telemetry is off) and lands wherever the sink points
 * (Sentry today; a product-analytics or Supabase backend later).
 *
 * Privacy: the only identifier is a random, opaque `install_id` minted locally —
 * not derived from anything personal, never a user/account id. No persona
 * content, prompts, or credentials are ever attached.
 */
import { getAnalyticsSink } from './sink';

const INSTALL_ID_KEY = 'personas.install_id';
const REACHED_KEY = 'personas.activation_reached';
const REFERRER_KEY = 'personas.referrer';

/**
 * The ordered activation funnel. Ordinals drive funnel analysis (step N is only
 * meaningful relative to N-1). `persona_created → execution_completed → shared`
 * is the core value→virality path; `imported` is the *receiving* end of someone
 * else's share (a new install that got value from the network), tracked at the
 * top of its own entry path.
 */
export const ACTIVATION_FUNNEL = [
  'imported',
  'persona_created',
  'execution_completed',
  'shared',
] as const;

export type ActivationStep = (typeof ACTIVATION_FUNNEL)[number];

function ordinalOf(step: ActivationStep): number {
  return ACTIVATION_FUNNEL.indexOf(step) + 1;
}

/** Safe localStorage access (tests / non-browser contexts have no `window`). */
function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // localStorage can throw (private mode, disabled)
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // Fallback: time-free random (Date.now is unavailable in some sandboxes).
  return 'inst-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * The pseudonymous install id — minted once, persisted, stable for the life of
 * the install. Used to sequence conversions into a funnel and (later) attribute
 * referrals, without identifying the user.
 */
export function getInstallId(): string {
  const store = ls();
  if (!store) return 'ephemeral'; // no persistence → don't poison the funnel with a fresh id each call
  let id = store.getItem(INSTALL_ID_KEY);
  if (!id) {
    id = randomId();
    try {
      store.setItem(INSTALL_ID_KEY, id);
    } catch {
      /* best-effort */
    }
  }
  return id;
}

function readReached(): Set<string> {
  const store = ls();
  if (!store) return new Set();
  try {
    const raw = store.getItem(REACHED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeReached(reached: Set<string>): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(REACHED_KEY, JSON.stringify([...reached]));
  } catch {
    /* best-effort */
  }
}

/** Which activation milestones this install has already reached. */
export function getReachedActivations(): ActivationStep[] {
  const reached = readReached();
  return ACTIVATION_FUNNEL.filter((s) => reached.has(s));
}

/** Has this install reached a given milestone? (drives "share your first agent" nudges, etc.) */
export function hasReachedActivation(step: ActivationStep): boolean {
  return readReached().has(step);
}

/**
 * Record an activation milestone. Fires the conversion event through the active
 * sink the FIRST time only; subsequent calls for the same step are no-ops.
 * Returns true if this call was the first (i.e. it fired).
 */
export function markActivation(step: ActivationStep): boolean {
  const reached = readReached();
  if (reached.has(step)) return false;
  reached.add(step);
  writeReached(reached);
  try {
    getAnalyticsSink().conversion({ step, ordinal: ordinalOf(step), installId: getInstallId() });
  } catch {
    /* sink failures must never break the calling flow */
  }
  // A referred install is only credited once it reaches a real milestone.
  recordReferralOnce();
  return true;
}

let referralRecorded = false;

/**
 * If this install was referred (a code was captured from a `personas://ref/…`
 * deep link), credit the referrer — once. Best-effort and idempotent: the cloud
 * dedupes on install id, and we only latch `referralRecorded` on success so a
 * transient failure (e.g. not yet authenticated) retries on a later milestone.
 * Safe to call from multiple places (activation + the moment a code is captured).
 */
export function recordReferralOnce(): void {
  if (referralRecorded) return;
  const referrer = getReferrer();
  if (!referrer) return;
  void (async () => {
    try {
      const { recordReferral } = await import('@/api/agents/personas');
      await recordReferral(referrer, getInstallId());
      referralRecorded = true;
    } catch {
      /* best-effort — retried on the next activation */
    }
  })();
}

/**
 * Capture a referral code the FIRST time this install sees one (e.g. from a
 * `personas://ref/<code>` deep link or a download-page param). Stored once so a
 * later referral-attribution pass can credit the referrer. Idempotent — a
 * referrer is never overwritten once set.
 */
export function captureReferrerOnce(code: string): void {
  if (!code) return;
  const store = ls();
  if (!store) return;
  try {
    if (!store.getItem(REFERRER_KEY)) store.setItem(REFERRER_KEY, code);
  } catch {
    /* best-effort */
  }
}

/** The referrer code captured at install time, if any. */
export function getReferrer(): string | null {
  const store = ls();
  if (!store) return null;
  try {
    return store.getItem(REFERRER_KEY);
  } catch {
    return null;
  }
}
