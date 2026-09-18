// usageVariant — which layout the Monitor's resource strip paints.
//
// A per-viewer preference, exactly like `board/queue/boardVariant`: the choice
// of layout is this browser profile's, so it lives in localStorage through the
// shared guarded door — a disabled or full storage never breaks the strip.
// `classic` is today's strip and the default; a missing, unknown or retired
// value reads as `classic`, and `isUsageVariant` is the only decision.
//
// PROTOTYPE ROUND. Four variants are auditioned beside `classic`. Consolidating
// on a winner is meant to be a pure deletion: drop the losers from this list and
// from `variants/`, and a stored name that no longer exists falls back by itself.

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const USAGE_VARIANTS = ['classic', 'lanes', 'horizon', 'cockpit', 'ledger'] as const;
export type UsageVariant = (typeof USAGE_VARIANTS)[number];

export const USAGE_VARIANT_KEY = 'monitor.usage.variant';
export const DEFAULT_USAGE_VARIANT: UsageVariant = 'classic';

export function isUsageVariant(v: unknown): v is UsageVariant {
  return typeof v === 'string' && (USAGE_VARIANTS as readonly string[]).includes(v);
}

/** The persisted variant, or `classic` for a missing / unknown / unreadable value. */
export function readUsageVariant(): UsageVariant {
  const raw = safeLocalGet(USAGE_VARIANT_KEY, 'monitor/usageVariant read');
  return isUsageVariant(raw) ? raw : DEFAULT_USAGE_VARIANT;
}

export function writeUsageVariant(v: UsageVariant): void {
  safeLocalSet(USAGE_VARIANT_KEY, v, 'monitor/usageVariant write');
}
