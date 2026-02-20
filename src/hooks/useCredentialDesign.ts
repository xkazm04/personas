import { useState, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { startCredentialDesign, cancelCredentialDesign } from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';

export type CredentialDesignPhase = 'idle' | 'analyzing' | 'preview' | 'saving' | 'done' | 'error';

export interface CredentialDesignConnector {
  name: string;
  label: string;
  category: string;
  color: string;
  oauth_type?: string | null;
  fields: { key: string; label: string; type: string; required: boolean; placeholder?: string; helpText?: string }[];
  healthcheck_config: object | null;
  services: unknown[];
  events: unknown[];
}

export interface CredentialDesignResult {
  match_existing: string | null;
  connector: CredentialDesignConnector;
  setup_instructions: string;
  summary: string;
}

interface DesignOutputPayload {
  design_id: string;
  line: string;
}

interface DesignStatusPayload {
  design_id: string;
  status: string;
  result?: CredentialDesignResult;
  error?: string;
}

export function useCredentialDesign() {
  const [phase, setPhase] = useState<CredentialDesignPhase>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [result, setResult] = useState<CredentialDesignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const createCredential = usePersonaStore((s) => s.createCredential);

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const start = useCallback(async (instruction: string) => {
    cleanup();
    setPhase('analyzing');
    setOutputLines([]);
    setResult(null);
    setError(null);

    try {
      const unlistenOutput = await listen<DesignOutputPayload>('credential-design-output', (event) => {
        setOutputLines((prev) => [...prev, event.payload.line]);
      });

      const unlistenStatus = await listen<DesignStatusPayload>('credential-design-status', (event) => {
        const { status, result: designResult, error: designError } = event.payload;

        if (status === 'completed' && designResult) {
          setResult(designResult);
          setPhase('preview');
          cleanup();
        } else if (status === 'failed') {
          setError(designError || 'Credential design failed');
          setPhase('error');
          cleanup();
        }
      });

      unlistenersRef.current = [unlistenOutput, unlistenStatus];

      await startCredentialDesign(instruction);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start credential design');
      setPhase('error');
      cleanup();
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelCredentialDesign().catch(() => {});
    cleanup();
    setPhase('idle');
    setOutputLines([]);
    setError(null);
  }, [cleanup]);

  const save = useCallback(async (
    credentialName: string,
    fieldValues: Record<string, string>,
    healthcheckOverride?: Record<string, unknown> | null,
  ) => {
    if (!result) return;

    setPhase('saving');
    try {
      // Create connector definition if it doesn't already exist
      if (!result.match_existing) {
        const conn = result.connector;
        await createConnectorDefinition({
          name: conn.name,
          label: conn.label,
          category: conn.category,
          color: conn.color,
          fields: JSON.stringify(conn.fields),
          healthcheck_config: JSON.stringify(healthcheckOverride ?? conn.healthcheck_config ?? null),
          services: JSON.stringify(conn.services || []),
          events: JSON.stringify(conn.events || []),
          metadata: JSON.stringify({
            template_enabled: true,
            setup_instructions: result.setup_instructions,
            summary: result.summary,
          }),
          is_builtin: false,
        });
      }

      // Create the credential
      const serviceType = result.match_existing || result.connector.name;
      await createCredential({
        name: credentialName,
        service_type: serviceType,
        data: fieldValues,
      });

      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
      setPhase('preview');
    }
  }, [result, createConnectorDefinition, createCredential]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setOutputLines([]);
    setResult(null);
    setError(null);
  }, [cleanup]);

  const loadTemplate = useCallback((template: CredentialDesignResult) => {
    cleanup();
    setOutputLines([]);
    setError(null);
    setResult(template);
    setPhase('preview');
  }, [cleanup]);

  return {
    phase,
    outputLines,
    result,
    error,
    start,
    cancel,
    save,
    reset,
    loadTemplate,
  };
}
