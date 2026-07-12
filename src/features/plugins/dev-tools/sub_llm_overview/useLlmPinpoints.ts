import { useCallback, useEffect, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import {
  fetchLlmPinpoints,
  hasLiveAdapter,
  type LlmPinpoint,
  type LlmWindow,
} from './llmTracingAdapters';

/**
 * Connection states for the LLM Overview surface, mirroring the dev-tools
 * Overview page's 5-state model:
 * - `empty`       — no LLM-observability credential exists in the vault.
 * - `unmapped`    — credentials exist but none is assigned to this project.
 * - `unsupported` — a credential is assigned but its adapter isn't wired yet
 *                   (e.g. Langfuse before Phase 2b).
 * - `loading` / `connected` / `error` — self-explanatory.
 */
export type LlmConnState =
  | 'empty'
  | 'unmapped'
  | 'unsupported'
  | 'loading'
  | 'connected'
  | 'error';

/**
 * Service types the LLM Overview treats as LLM-observability connectors. Mirrors
 * `LLM_TRACKING_SERVICE_TYPES` in the Teams passport connector spec, narrowed to
 * the four that ship as builtin connectors today.
 */
export const LLM_TRACKING_SERVICE_TYPES = new Set([
  'langfuse',
  'helicone',
  'langsmith',
  'tracklight',
]);

export function isLlmTrackingCred(c: PersonaCredential): boolean {
  return LLM_TRACKING_SERVICE_TYPES.has(c.serviceType.toLowerCase());
}

/**
 * Data layer for the LLM Overview tab. Resolves the active project's assigned
 * LLM-observability credential (`dev_projects.llm_tracking_credential_id`),
 * fetches + folds pinpoints through the shared wrapper, and exposes the rolling
 * window control. One hook per mount, so the table + header share state.
 */
export function useLlmPinpoints() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );

  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [credLoaded, setCredLoaded] = useState(false);
  const [timeWindow, setTimeWindow] = useState<LlmWindow>('30d');

  const [state, setState] = useState<LlmConnState>('loading');
  const [pinpoints, setPinpoints] = useState<LlmPinpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cred, setCred] = useState<PersonaCredential | null>(null);

  useEffect(() => {
    listCredentials()
      .then((creds) => {
        setCredentials(creds);
        setCredLoaded(true);
      })
      .catch(() => setCredLoaded(true));
  }, []);

  const llmCreds = credentials.filter(isLlmTrackingCred);

  const load = useCallback(async () => {
    if (!activeProject || !credLoaded) return;

    const credId = activeProject.llm_tracking_credential_id;
    setError(null);

    if (!credId) {
      setState(llmCreds.length > 0 ? 'unmapped' : 'empty');
      setCred(null);
      return;
    }
    const c = credentials.find((x) => x.id === credId);
    if (!c) {
      setState('unmapped');
      setCred(null);
      return;
    }
    setCred(c);

    const serviceType = c.serviceType.toLowerCase();
    if (!hasLiveAdapter(serviceType)) {
      setState('unsupported');
      return;
    }

    setState('loading');
    try {
      const rows = await fetchLlmPinpoints(serviceType, c.id, timeWindow);
      setPinpoints(rows);
      setState('connected');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeProject, credentials, credLoaded, llmCreds.length, timeWindow]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    activeProjectId,
    activeProject,
    credLoaded,
    llmCreds,
    cred,
    state,
    pinpoints,
    error,
    timeWindow,
    setTimeWindow,
    reload: load,
  };
}

export type LlmPinpointsData = ReturnType<typeof useLlmPinpoints>;
