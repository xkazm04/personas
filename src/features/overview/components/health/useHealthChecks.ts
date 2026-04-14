import { useState, useEffect, useCallback, useRef } from 'react';
import type { HealthCheckItem, HealthCheckSection } from "@/api/system/system";
import { healthCheckAccount, healthCheckAgents, healthCheckCloud, healthCheckLocal, healthCheckSubscriptions } from "@/api/system/system";

const SECTION_ORDER = ['local', 'agents', 'cloud', 'account', 'subscriptions'];

function makeFallback(id: string, label: string, items: HealthCheckItem[]): HealthCheckSection {
  return { id, label, items };
}

const IPC_FALLBACKS: Record<string, HealthCheckSection> = {
  local: makeFallback('local', 'Local Environment', [
    { id: 'ipc', label: 'Application Bridge', status: 'error', detail: 'The Tauri IPC bridge is not responding. The app may need to be rebuilt or restarted.', installable: false },
  ]),
  agents: makeFallback('agents', 'Agents', [
    { id: 'ollama_api_key', label: 'Ollama Cloud API Key', status: 'inactive', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
    { id: 'litellm_proxy', label: 'LiteLLM Proxy', status: 'inactive', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
  ]),
  cloud: makeFallback('cloud', 'Cloud Deployment', [
    { id: 'cloud_orchestrator', label: 'Cloud Orchestrator', status: 'info', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
  ]),
  account: makeFallback('account', 'Account', [
    { id: 'google_auth', label: 'Google Account', status: 'inactive', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
  ]),
  subscriptions: makeFallback('subscriptions', 'Subscription Health', [
    { id: 'subscriptions_empty', label: 'Subscriptions', status: 'info', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
  ]),
};

const CHECKS: Array<{ id: string; fn: () => Promise<HealthCheckSection> }> = [
  { id: 'local', fn: healthCheckLocal },
  { id: 'agents', fn: healthCheckAgents },
  { id: 'cloud', fn: healthCheckCloud },
  { id: 'account', fn: healthCheckAccount },
  { id: 'subscriptions', fn: healthCheckSubscriptions },
];

function sortSections(arr: HealthCheckSection[]) {
  return arr.sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id));
}

export function useHealthChecks() {
  const [sections, setSections] = useState<HealthCheckSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasIssues, setHasIssues] = useState(false);
  const [ipcError, setIpcError] = useState(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);

  const runChecks = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const gen = ++generationRef.current;
    setLoading(true);
    setIpcError(false);
    setSections([]);

    Promise.allSettled(CHECKS.map((check) => check.fn()))
      .then((results) => {
        if (generationRef.current !== gen) return;

        let anyIpcError = false;
        const resolved: HealthCheckSection[] = results.map((result, i) => {
          if (result.status === 'fulfilled') return result.value;
          anyIpcError = true;
          const checkId = CHECKS[i]!.id;
          return IPC_FALLBACKS[checkId]!;
        });

        const sorted = sortSections(resolved);
        const allOk = sorted.every((s) =>
          s.items.every((item) => item.status === 'ok' || item.status === 'info' || item.status === 'inactive')
        );

        setSections(sorted);
        setHasIssues(!allOk);
        setIpcError(anyIpcError);
        setLoading(false);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  return { sections, loading, hasIssues, ipcError, runChecks };
}
