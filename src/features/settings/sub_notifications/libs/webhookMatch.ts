/**
 * Pure helpers behind the outbound webhook subscription editor: the pattern
 * grammar (a TS mirror of the dispatcher's matcher), a preview of what a set
 * of patterns would have fired over recent events, a verdict per pattern
 * against the known event vocabulary, and each subscription's delivery health.
 *
 * Nothing here talks to IPC. The subscription payload shape is unchanged:
 * `eventTypes` is still sent as a `string[]` through create/update.
 */
import type { NotificationSubscription } from '@/lib/bindings/NotificationSubscription';
import { silentCatch } from '@/lib/silentCatch';

export type WebhookProvider = 'slack' | 'discord' | 'teams' | 'generic';

export interface WebhookDraft {
  id?: string;
  label: string;
  provider: WebhookProvider;
  webhookUrl: string;
  /** Raw comma/newline separated pattern list, as edited. */
  eventTypes: string;
  templateBody: string;
  enabled: boolean;
}

/**
 * A new draft opens with NO patterns. The old default
 * ('execution.finished, healing.escalated') matched nothing any producer
 * publishes; the picker fills the list from the observed vocabulary instead.
 */
export const EMPTY_WEBHOOK_DRAFT: WebhookDraft = {
  label: '',
  provider: 'slack',
  webhookUrl: '',
  eventTypes: '',
  templateBody: '',
  enabled: true,
};

export function parseEventTypes(raw: string): string[] {
  return raw
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** `event_types` is stored as a JSON string[]; fall back to the raw text for a legacy/corrupt value. */
export function eventTypesToString(stored: string): string {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch (err) {
    // Not JSON: show the stored text verbatim so the operator can repair it.
    silentCatch('features/settings/sub_notifications/libs/webhookMatch:eventTypesToString')(err);
  }
  return stored;
}

export function draftToPayload(draft: WebhookDraft) {
  return {
    label: draft.label.trim(),
    provider: draft.provider,
    webhookUrl: draft.webhookUrl.trim() || null,
    credentialId: null,
    eventTypes: parseEventTypes(draft.eventTypes),
    templateBody: draft.templateBody.trim() || null,
    enabled: draft.enabled,
  };
}

/**
 * Mirror of `pattern_matches` in src-tauri/src/engine/webhook_notifier.rs:
 * exact, a '.'-anchored `prefix.*` family, or `*`. Pinned against the Rust
 * unit assertions by webhookPatternParity.test.ts.
 */
export function patternMatches(pattern: string, eventType: string): boolean {
  if (pattern === eventType) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return (
      eventType.startsWith(prefix) &&
      (eventType.length === prefix.length || eventType.charAt(prefix.length) === '.')
    );
  }
  return pattern === '*';
}

const anyMatch = (patterns: readonly string[], eventType: string) =>
  patterns.some((p) => patternMatches(p, eventType));

/** `execution.*` looks like it covers `execution_completed`, and does not. */
function separatorMiss(pattern: string, eventType: string): boolean {
  if (!pattern.endsWith('.*')) return false;
  return eventType.startsWith(`${pattern.slice(0, -2)}_`);
}

export interface MatchableEvent {
  event_type: string;
  created_at: string;
}

export interface MatchPreview {
  /** True when there are no patterns at all. */
  empty: boolean;
  count: number;
  byType: Record<string, number>;
  lastAt: string | null;
  lastType: string | null;
  /** Unmatched event types a dotted family pattern only appears to cover. */
  separatorMisses: Array<{ pattern: string; eventType: string }>;
}

export function previewMatches(
  patterns: readonly string[],
  events: readonly MatchableEvent[],
): MatchPreview {
  const preview: MatchPreview = {
    empty: patterns.length === 0,
    count: 0,
    byType: {},
    lastAt: null,
    lastType: null,
    separatorMisses: [],
  };
  const missed = new Set<string>();
  for (const e of events) {
    if (!anyMatch(patterns, e.event_type)) {
      for (const p of patterns) {
        const key = `${p}\u0000${e.event_type}`;
        if (!missed.has(key) && separatorMiss(p, e.event_type)) {
          missed.add(key);
          preview.separatorMisses.push({ pattern: p, eventType: e.event_type });
        }
      }
      continue;
    }
    preview.count += 1;
    preview.byType[e.event_type] = (preview.byType[e.event_type] ?? 0) + 1;
    if (preview.lastAt === null || Date.parse(e.created_at) > Date.parse(preview.lastAt)) {
      preview.lastAt = e.created_at;
      preview.lastType = e.event_type;
    }
  }
  return preview;
}

export interface VocabularyEntry {
  eventType: string;
  source: string;
}

export interface PatternVerdict {
  pattern: string;
  /** `known`: an exact vocabulary type. `family`: a `.*`/`*` pattern that covers at least one. */
  status: 'known' | 'family' | 'unknown';
  matches: string[];
  /** Nearest vocabulary type for an `unknown` pattern, or null when nothing is close. */
  suggestion: string | null;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function suggest(pattern: string, types: readonly string[]): string | null {
  if (pattern.endsWith('.*')) {
    return types.find((t) => separatorMiss(pattern, t)) ?? null;
  }
  const limit = Math.max(2, Math.floor(pattern.length / 6));
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const t of types) {
    const d = editDistance(pattern.toLowerCase(), t.toLowerCase());
    if (d < bestDistance) {
      best = t;
      bestDistance = d;
    }
  }
  return best;
}

export function classifyPatterns(
  patterns: readonly string[],
  vocabulary: readonly VocabularyEntry[],
): PatternVerdict[] {
  const types = [...new Set(vocabulary.map((v) => v.eventType))];
  return patterns.map((pattern) => {
    const matches = types.filter((t) => patternMatches(pattern, t));
    const isFamily = pattern === '*' || pattern.endsWith('.*');
    if (matches.length > 0) {
      return { pattern, status: isFamily ? 'family' : 'known', matches, suggestion: null };
    }
    return { pattern, status: 'unknown', matches, suggestion: suggest(pattern, types) };
  });
}

export type DeliveryHealth =
  | { tone: 'idle'; neverDelivered: true }
  | { tone: 'ok'; at: string }
  | { tone: 'error'; error: string | null; at: string };

/**
 * The delivery ledger the dispatcher records per subscription
 * (`record_delivery`: status `success` | `failed`, error verbatim). The Test
 * button writes the same ledger, so a test counts as a delivery here.
 */
export function deliveryHealth(
  sub: Pick<NotificationSubscription, 'enabled' | 'lastDeliveryAt' | 'lastDeliveryStatus' | 'lastError'>,
): DeliveryHealth {
  if (!sub.lastDeliveryAt) return { tone: 'idle', neverDelivered: true };
  if (sub.lastDeliveryStatus === 'success') return { tone: 'ok', at: sub.lastDeliveryAt };
  return { tone: 'error', error: sub.lastError, at: sub.lastDeliveryAt };
}
