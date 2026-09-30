// The Factory L2 Observability tab's two feeds, moved unchanged out of the tab
// when it was composed from the kit. `null` rows = still loading; the failed
// flags say the fetch REJECTED, which used to be written as `[]` and was
// therefore indistinguishable from a healthy empty. Failure is not emptiness:
// it is retryable, and it is never good news.
import { useEffect, useMemo, useState } from 'react';

import { useVaultStore } from '@/stores/vaultStore';
import {
  fetchLlmPinpoints,
  hasLiveAdapter,
  type LlmPinpoint,
} from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import {
  fetchSentryUnresolvedIssues,
  splitSentrySlug,
  type SentryUnresolvedIssue,
} from '@/features/plugins/dev-tools/sub_overview/adapters';
import { silentCatch } from '@/lib/silentCatch';

import type { FactoryL2Data } from './factoryL2Data';

export function useObservabilityFeeds(data: FactoryL2Data) {
  const credentials = useVaultStore((s) => s.credentials);
  const [pinpoints, setPinpoints] = useState<LlmPinpoint[] | null>(null);
  const [issues, setIssues] = useState<SentryUnresolvedIssue[] | null>(null);
  const [llmFailed, setLlmFailed] = useState(false);
  const [issuesFailed, setIssuesFailed] = useState(false);
  // Bumped by the retry buttons; re-runs the effect that owns each adapter.
  const [llmNonce, setLlmNonce] = useState(0);
  const [issuesNonce, setIssuesNonce] = useState(0);

  const project = data.project;
  const llmCredId = project?.llm_tracking_credential_id ?? null;
  const llmServiceType = useMemo(
    () => (llmCredId ? credentials.find((c) => c.id === llmCredId)?.serviceType ?? null : null),
    [llmCredId, credentials],
  );
  const monCredId = project?.monitoring_credential_id ?? null;
  const monSlug = project?.monitoring_project_slug ?? null;

  useEffect(() => {
    if (!llmCredId || !llmServiceType || !hasLiveAdapter(llmServiceType)) { setPinpoints(null); setLlmFailed(false); return; }
    let alive = true;
    setLlmFailed(false);
    setPinpoints(null);
    void fetchLlmPinpoints(llmServiceType, llmCredId, '30d')
      .then((rows) => { if (alive) setPinpoints(rows); })
      .catch((e) => { silentCatch('factoryL2:obs-llm')(e); if (alive) setLlmFailed(true); });
    return () => { alive = false; };
  }, [llmCredId, llmServiceType, llmNonce]);

  useEffect(() => {
    const [orgSlug, projSlug] = splitSentrySlug(monSlug);
    if (!monCredId || !orgSlug || !projSlug) { setIssues(null); setIssuesFailed(false); return; }
    let alive = true;
    setIssuesFailed(false);
    setIssues(null);
    void fetchSentryUnresolvedIssues(monCredId, orgSlug, projSlug)
      .then((rows) => { if (alive) setIssues(rows); })
      .catch((e) => { silentCatch('factoryL2:obs-sentry')(e); if (alive) setIssuesFailed(true); });
    return () => { alive = false; };
  }, [monCredId, monSlug, issuesNonce]);

  return {
    pinpoints, issues, llmFailed, issuesFailed,
    llmWired: data.llmWired && !!llmServiceType,
    retryLlm: () => setLlmNonce((n) => n + 1),
    retryIssues: () => setIssuesNonce((n) => n + 1),
  };
}
