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

/** projectId → 30d spend in USD (null = fetched, nothing to show). Session-scoped. */
const spendCache = new Map<string, number | null>();
const inFlight = new Set<string>();

export function LlmTrackingCell({ slug, label }: { slug: string; label: string | null }) {
  const engine = useImprove();
  const credentials = useVaultStore((s) => s.credentials);
  const [spend, setSpend] = useState<number | null | undefined>(() => spendCache.get(slug));

  const raw = engine?.getRaw(slug);
  const credId = raw?.project.llm_tracking_credential_id ?? null;
  const cred = credId ? credentials.find((c) => c.id === credId) ?? null : null;

  useEffect(() => {
    if (!credId || !cred || !hasLiveAdapter(cred.serviceType)) return;
    if (spendCache.has(slug)) {
      setSpend(spendCache.get(slug));
      return;
    }
    if (inFlight.has(slug)) return;
    inFlight.add(slug);
    let cancelled = false;
    void fetchLlmPinpoints(cred.serviceType, credId, '30d')
      .then((rows) => {
        const total = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
        const value = rows.length > 0 ? total : null;
        spendCache.set(slug, value);
        if (!cancelled) setSpend(value);
      })
      .catch((e) => {
        // Telemetry being down must never degrade the wall — cache the miss so
        // we don't retry it on every re-render.
        spendCache.set(slug, null);
        silentCatch('LlmTrackingCell:fetchLlmPinpoints')(e);
      })
      .finally(() => inFlight.delete(slug));
    return () => {
      cancelled = true;
    };
  }, [slug, credId, cred]);

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
