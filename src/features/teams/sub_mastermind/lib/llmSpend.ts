// 30-day LLM spend per project — the same derivation LlmTrackingCell uses
// (fetchLlmPinpoints over the project's bound tracing credential, spend = sum
// of totalCostUsd), batched with bounded concurrency for the whole portfolio.
// Absent map key = project has no supported tracing credential (honestly not
// wired); `null` = wired but the connector returned no rows in the window.
import { fetchLlmPinpoints, hasLiveAdapter } from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { silentCatch } from '@/lib/silentCatch';

import { mapWithConcurrency } from './sceneStore';

export async function loadLlmSpendMap(
  projects: readonly DevProject[],
  credentials: readonly PersonaCredential[],
): Promise<Map<string, number | null>> {
  const credById = new Map(credentials.map((c) => [c.id, c]));
  const wired = projects.flatMap((p) => {
    const cred = p.llm_tracking_credential_id ? credById.get(p.llm_tracking_credential_id) : undefined;
    return cred && hasLiveAdapter(cred.serviceType) ? [{ projectId: p.id, cred }] : [];
  });
  const out = new Map<string, number | null>();
  await mapWithConcurrency(wired, 4, async ({ projectId, cred }) => {
    try {
      const rows = await fetchLlmPinpoints(cred.serviceType, cred.id, '30d');
      const total = rows.reduce((s, r) => s + r.totalCostUsd, 0);
      out.set(projectId, rows.length > 0 ? total : null);
    } catch (err) {
      // One connector failing must not sink the family — that project simply
      // stays unwired-looking ("—") until the next refresh.
      silentCatch('mastermind llmSpend')(err);
    }
  });
  return out;
}
