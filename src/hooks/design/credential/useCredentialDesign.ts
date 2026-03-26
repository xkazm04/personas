import { useState, useCallback, useRef } from 'react';
import { cancelCredentialDesign, startCredentialDesign } from "@/api/vault/credentialDesignApi";
import { createLogger } from '@/lib/log';

const logger = createLogger('credential-design');
import { EventName } from '@/lib/eventRegistry';

import { useVaultStore } from "@/stores/vaultStore";
import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { saveRecipeFromDesign } from '@/lib/credentials/credentialRecipeRegistry';

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

export function useCredentialDesign() {
  const [savedCredentialId, setSavedCredentialId] = useState<string | null>(null);
  const [registeredConnectorName, setRegisteredConnectorName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const createConnectorDefinition = useVaultStore((s) => s.createConnectorDefinition);
  const deleteConnectorDefinition = useVaultStore((s) => s.deleteConnectorDefinition);
  const createCredential = useVaultStore((s) => s.createCredential);

  const flow = useAiArtifactTask<[string], CredentialDesignResult>({
    progressEvent: 'credential-design-output',
    statusEvent: EventName.CREDENTIAL_DESIGN_STATUS,
    runningPhase: 'analyzing',
    completedPhase: 'preview',
    startFn: startCredentialDesign,
    cancelFn: cancelCredentialDesign,
    errorMessage: 'Credential design failed',
    traceOperation: 'credential_design',
  });

  const save = useCallback(async (
    credentialName: string,
    fieldValues: Record<string, string>,
    healthcheckOverride?: Record<string, unknown> | null,
  ) => {
    if (savingRef.current) return;

    // Snapshot result at invocation time so concurrent state changes
    // (e.g. refine click, modal close) cannot silently invalidate it.
    const snapshot = flow.result;
    if (!snapshot || !snapshot.connector?.name) {
      flow.setError('Design result is missing -- please run the design again');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    flow.setPhase('saving');
    let createdConnectorId: string | null = null;
    try {
      // Create connector definition if it doesn't already exist
      if (!snapshot.match_existing) {
        const conn = snapshot.connector;
        // Check for existing connector with the same name to avoid unique constraint errors
        const existing = connectorDefinitions.find(
          (c) => c.name.toLowerCase() === conn.name.toLowerCase(),
        );
        if (existing) {
          // Reuse existing connector -- no need to create or rollback
          setRegisteredConnectorName(existing.label);
        } else {
          const connector = await createConnectorDefinition({
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
              setup_instructions: snapshot.setup_instructions,
              summary: snapshot.summary,
            }),
            is_builtin: false,
          });
          createdConnectorId = connector.id;
          setRegisteredConnectorName(conn.label);
        }
      }

      // Create the credential
      const serviceType = snapshot.match_existing || snapshot.connector.name;
      const credId = await createCredential({
        name: credentialName,
        service_type: serviceType,
        data: fieldValues,
      });

      setSavedCredentialId(credId);

      // Cache the recipe for reuse by Negotiator and AutoCred paths
      void saveRecipeFromDesign(snapshot).catch((err) => {
        logger.warn('Failed to cache recipe from design (non-critical)', { error: String(err) });
      });

      flow.setPhase('done');
    } catch (err) {
      // Rollback: if we created a connector but credential creation failed,
      // delete the orphan connector to avoid inconsistent state.
      if (createdConnectorId) {
        try {
          await deleteConnectorDefinition(createdConnectorId);
        } catch { /* intentional: non-critical -- rollback is best-effort */ }
      }
      flow.setError(err instanceof Error ? err.message : 'Failed to save credential');
      flow.setPhase('preview');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [flow.result, flow.setPhase, flow.setError, createConnectorDefinition, deleteConnectorDefinition, createCredential]);

  const reset = useCallback(() => {
    savingRef.current = false;
    setIsSaving(false);
    flow.reset();
    setSavedCredentialId(null);
    setRegisteredConnectorName(null);
  }, [flow.reset]);

  const loadTemplate = useCallback((template: CredentialDesignResult) => {
    flow.cleanup();
    flow.setLines([]);
    flow.setError(null);
    flow.setResult(template);
    flow.setPhase('preview');
  }, [flow.cleanup, flow.setLines, flow.setError, flow.setResult, flow.setPhase]);

  /**
   * Refine: restart the design stream with a new instruction while
   * preserving the previous result as context for the backend prompt.
   * Unlike `reset` + `start`, this does NOT clear `savedCredentialId`
   * so the modal can still navigate to the credential created earlier.
   */
  const refine = useCallback(
    (instruction: string) => {
      if (savingRef.current) return;
      // Transition back to analyzing -- keep savedCredentialId intact
      flow.setLines([]);
      flow.setError(null);
      flow.start(instruction);
    },
    [flow.setLines, flow.setError, flow.start],
  );

  return {
    phase: flow.phase as CredentialDesignPhase,
    outputLines: flow.lines,
    result: flow.result,
    error: flow.error,
    savedCredentialId,
    registeredConnectorName,
    isSaving,
    start: flow.start,
    cancel: flow.cancel,
    save,
    reset,
    refine,
    loadTemplate,
  };
}
