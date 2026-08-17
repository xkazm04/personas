// The `llmtracking` passport cell, enriched with LIVE wiring (Findings Loop §2 1C).
//
// The scan-derived passport only knows "connected / null". The project row knows
// WHICH connector is bound, and the connector itself knows what the project spent
// on LLM calls in the last 30 days. Both are cheap reads the wall shouldn't block
// on, so we render the base cell immediately and fill the sub-label in when the
// spend resolves. One fetch per project per session (module-level cache).
import { useEffect, useState } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useVaultStore } from '@/stores/vaultStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  fetchLlmPinpoints,
  hasLiveAdapter,
} from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import { useImprove } from './improve/ImproveContext';

/** `slug|credId` → 30d spend in USD (null = fetched, nothing to show). Session-scoped.
 *
 *  The key carries `credId` because the VALUE does. Keyed on `slug` alone until
 *  2026-08-16, and the cache branch below beats the effect's own `credId`
 *  dependency — so rebinding a project's observability connector re-rendered the
 *  NEW connector's name over the OLD connector's number, and never queried the
 *  new one. Replayed under real React: `Helicone staging · ≈$412.50/30d` where
 *  the truth was $7.25.
 *
 *  A cache key must name everything the value depends on. This one named the
 *  thing the component was *about* instead. */
const spendCache = new Map<string, number | null>();
const inFlight = new Set<string>();

export function LlmTrackingCell({ slug, label }: { slug: string; label: string | null }) {
  const engine = useImprove();
  const credentials = useVaultStore((s) => s.credentials);
  const raw = engine?.getRaw(slug);
  const credId = raw?.project.llm_tracking_credential_id ?? null;
  const cred = credId ? credentials.find((c) => c.id === credId) ?? null : null;
  const cacheKey = `${slug}|${credId ?? ''}`;

  const [spend, setSpend] = useState<number | null | undefined>(() => spendCache.get(cacheKey));

  useEffect(() => {
    if (!credId || !cred || !hasLiveAdapter(cred.serviceType)) return;
    if (spendCache.has(cacheKey)) {
      setSpend(spendCache.get(cacheKey));
      return;
    }
    if (inFlight.has(cacheKey)) return;
    inFlight.add(cacheKey);
    let cancelled = false;
    void fetchLlmPinpoints(cred.serviceType, credId, '30d')
      .then((rows) => {
        const total = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
        const value = rows.length > 0 ? total : null;
        spendCache.set(cacheKey, value);
        if (!cancelled) setSpend(value);
      })
      .catch((e) => {
        // Telemetry being down must never degrade the wall — cache the miss so
        // we don't retry it on every re-render.
        spendCache.set(cacheKey, null);
        silentCatch('LlmTrackingCell:fetchLlmPinpoints')(e);
      })
      .finally(() => inFlight.delete(cacheKey));
    return () => {
      cancelled = true;
    };
  }, [cacheKey, credId, cred]);

  // The bound connector's own name beats the passport's generic "connected".
  const headline = cred?.name ?? label;

  return (
    <span className="inline-flex flex-col gap-0.5 min-w-0">
      {headline ? (
        <span className="typo-caption text-foreground truncate">{headline}</span>
      ) : (
        <span className="typo-caption text-foreground/35">—</span>
      )}
      {typeof spend === 'number' && (
        <span className="typo-label text-foreground/45 tabular-nums">
          ≈$<Numeric value={spend} precision={spend >= 1 ? 2 : 4} />
          <span className="ml-0.5">/30d</span>
        </span>
      )}
    </span>
  );
}
