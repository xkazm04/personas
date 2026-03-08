import { useState, useCallback, useRef } from 'react';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { usePersonaStore } from '@/stores/personaStore';
import { OAUTH_FIELD } from '@/features/vault/sub_design/CredentialDesignHelpers';
import type { WorkspaceProvider, WorkspaceService } from './workspaceProviders';
import { aggregateScopes } from './workspaceProviders';

export type ProvisionStatus = 'idle' | 'pending' | 'created' | 'failed';

export interface ServiceProvisionState {
  service: WorkspaceService;
  status: ProvisionStatus;
  credentialId?: string;
  error?: string;
}

export interface WorkspaceConnectState {
  /** Which services are selected for provisioning. */
  selectedServices: WorkspaceService[];
  /** Toggle a service on/off. */
  toggleService: (serviceType: string) => void;
  /** Select all services. */
  selectAll: () => void;
  /** Per-service provisioning status after OAuth completes. */
  provisionStates: ServiceProvisionState[];
  /** Whether the OAuth consent flow is active. */
  isAuthorizing: boolean;
  /** Whether credentials are currently being created. */
  isProvisioning: boolean;
  /** Overall phase. */
  phase: 'select' | 'authorizing' | 'provisioning' | 'done' | 'error';
  /** Error message if the overall flow failed. */
  error: string | null;
  /** Start the workspace connect flow. */
  startConnect: () => void;
  /** Reset to initial state. */
  reset: () => void;
}

export function useWorkspaceConnect(provider: WorkspaceProvider): WorkspaceConnectState {
  const createCredential = usePersonaStore((s) => s.createCredential);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);

  const [selectedServices, setSelectedServices] = useState<WorkspaceService[]>(
    () => [...provider.services],
  );
  const [provisionStates, setProvisionStates] = useState<ServiceProvisionState[]>([]);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [phase, setPhase] = useState<WorkspaceConnectState['phase']>('select');
  const [error, setError] = useState<string | null>(null);

  const selectedRef = useRef(selectedServices);
  selectedRef.current = selectedServices;

  const provisionCredentials = useCallback(
    async (refreshToken: string, scope: string | null) => {
      setIsProvisioning(true);
      setPhase('provisioning');

      const services = selectedRef.current;
      const states: ServiceProvisionState[] = services.map((svc) => ({
        service: svc,
        status: 'pending' as ProvisionStatus,
      }));
      setProvisionStates([...states]);

      const nowIso = new Date().toISOString();

      for (let i = 0; i < services.length; i++) {
        const svc = services[i]!;
        const state = states[i]!;
        try {
          const credId = await createCredential({
            name: `${svc.label} (Workspace)`,
            service_type: svc.serviceType,
            data: {
              refresh_token: refreshToken,
              scopes: svc.scopes.join(' '),
              [OAUTH_FIELD.SCOPE]: scope ?? svc.scopes.join(' '),
              [OAUTH_FIELD.COMPLETED_AT]: nowIso,
              [OAUTH_FIELD.CLIENT_MODE]: 'app_managed',
              workspace_provider: provider.id,
            },
          });
          states[i] = { ...state, status: 'created', credentialId: credId };
        } catch (err) {
          states[i] = {
            ...state,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
        setProvisionStates([...states]);
      }

      await fetchCredentials();
      setIsProvisioning(false);

      const anyFailed = states.some((s) => s.status === 'failed');
      setPhase(anyFailed ? 'error' : 'done');
    },
    [createCredential, fetchCredentials, provider.id],
  );

  const provisionRef = useRef(provisionCredentials);
  provisionRef.current = provisionCredentials;

  const googleOAuth = useGoogleOAuth({
    onSuccess: (data) => {
      void provisionRef.current(data.refresh_token, data.scope);
    },
    onError: (msg) => {
      setError(msg);
      setPhase('error');
    },
  });

  const toggleService = useCallback((serviceType: string) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.serviceType === serviceType);
      if (exists) return prev.filter((s) => s.serviceType !== serviceType);
      const svc = provider.services.find((s) => s.serviceType === serviceType);
      return svc ? [...prev, svc] : prev;
    });
  }, [provider.services]);

  const selectAll = useCallback(() => {
    setSelectedServices([...provider.services]);
  }, [provider.services]);

  const startConnect = useCallback(() => {
    if (selectedServices.length === 0) return;
    setError(null);
    setPhase('authorizing');
    setProvisionStates([]);

    const allScopes = aggregateScopes(selectedServices);
    // Use a synthetic connector name for the Google OAuth flow
    googleOAuth.startConsent('google_workspace', allScopes);
  }, [selectedServices, googleOAuth]);

  const reset = useCallback(() => {
    googleOAuth.reset();
    setSelectedServices([...provider.services]);
    setProvisionStates([]);
    setIsProvisioning(false);
    setPhase('select');
    setError(null);
  }, [googleOAuth, provider.services]);

  return {
    selectedServices,
    toggleService,
    selectAll,
    provisionStates,
    isAuthorizing: googleOAuth.isAuthorizing,
    isProvisioning,
    phase,
    error,
    startConnect,
    reset,
  };
}
