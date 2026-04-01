import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useCredentialDesign, type CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { useOAuthConsent } from '@/hooks/design/oauth/useOAuthConsent';
import { useUniversalOAuth } from '@/hooks/design/oauth/useUniversalOAuth';
import { useCredentialHealth } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { extractFirstUrl } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import { detectAuthenticatedServices } from '@/api/auth/authDetect';
import type { AuthDetectionInfo } from '@/hooks/design/credential/useCredentialNegotiator';
import type { CredentialDesignContextValue } from '@/features/vault/sub_catalog/components/design/CredentialDesignContext';
import type { CredentialDesignOrchestrator } from './orchestratorTypes';
import { useDesignFields, useFieldValidation } from './orchestratorDerived';
import { buildContextValue } from './orchestratorContext';

export type { CredentialDesignOrchestrator } from './orchestratorTypes';

/**
 * Composes useCredentialDesign, useOAuthConsent, useUniversalOAuth, and
 * useCredentialHealth into a single orchestrator that returns a ready-made
 * CredentialDesignContextValue plus the extra state the modal needs.
 */
export function useCredentialDesignOrchestrator(): CredentialDesignOrchestrator {
  const design = useCredentialDesign();
  const oauth = useOAuthConsent();
  const universalOAuth = useUniversalOAuth();
  const health = useCredentialHealth('design');

  const [instruction, setInstruction] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [negotiatorValues, setNegotiatorValues] = useState<Record<string, string>>({});
  const [refinementCount, setRefinementCount] = useState(0);
  const lastResultRef = useRef<CredentialDesignResult | null>(null);

  useEffect(() => {
    if (design.result) lastResultRef.current = design.result;
  }, [design.result]);

  // -- Prefetch auth detections during analyzing phase so results are
  //    warm-cached by the time the user opens the NegotiatorPanel. The
  //    backend has a 5-minute cache (AUTH_DETECT_CACHE_TTL), so even if
  //    the user takes a while in preview the results stay fresh. --
  const [prefetchedAuthDetections, setPrefetchedAuthDetections] = useState<AuthDetectionInfo[] | undefined>(undefined);
  const authPrefetchedRef = useRef(false);
  useEffect(() => {
    if (design.phase !== 'analyzing' && design.phase !== 'preview') return;
    if (authPrefetchedRef.current) return;
    authPrefetchedRef.current = true;
    let cancelled = false;
    detectAuthenticatedServices()
      .then((detections) => {
        if (cancelled) return;
        const mapped: AuthDetectionInfo[] = detections
          .filter((d) => d.authenticated)
          .map((d) => ({
            serviceType: d.service_type,
            method: d.method,
            authenticated: d.authenticated,
            identity: d.identity,
            confidence: d.confidence,
          }));
        setPrefetchedAuthDetections(mapped);
      })
      .catch(() => {
        if (!cancelled) setPrefetchedAuthDetections([]);
      });
    return () => { cancelled = true; };
  }, [design.phase]);

  // -- Derive OAuth status message --
  const oauthStatusMessage = useMemo(() => {
    const oMsg = oauth.message;
    const uMsg = universalOAuth.message;
    if (!oMsg && !uMsg) return null;
    if (!oMsg) return uMsg;
    if (!uMsg) return oMsg;
    return uMsg;
  }, [oauth.message, universalOAuth.message]);

  // -- Auto-set credential name --
  useEffect(() => {
    if (design.phase === 'preview' && design.result) {
      setCredentialName((prev) => prev || `${design.result!.connector.label} Credential`);
    }
  }, [design.phase, design.result]);

  // -- Derived values --
  const { fields, flow, effectiveFields, requiredCount, optionalCount } = useDesignFields(design.result);
  const firstSetupUrl = extractFirstUrl(design.result?.setup_instructions);

  const mergedOAuthValues = useMemo(
    () => ({ ...oauth.getValues(), ...universalOAuth.getValues(), ...negotiatorValues }),
    [oauth.valuesVersion, universalOAuth.valuesVersion, negotiatorValues],
  );

  const { canSaveCredential } = useFieldValidation(effectiveFields, mergedOAuthValues, flow, health.result);

  // -- Handlers --
  const start = useCallback(
    (override?: string) => {
      const text = (override ?? instruction).trim();
      if (!text) return;
      design.start(text);
    },
    [instruction, design.start],
  );

  const handleSave = useCallback(
    (values: Record<string, string>) => {
      const hcConfig = health.result?.healthcheckConfig ?? null;
      if (flow.kind === 'google_oauth' && values.refresh_token?.trim()) {
        const name = credentialName.trim() || `${design.result?.connector.label} Credential`;
        design.save(name, values, hcConfig);
        return;
      }
      if (!health.result?.success || !hcConfig) {
        health.setResult({
          success: false,
          message: 'Run Test Connection and get a successful result before saving.',
        });
        return;
      }
      const name = credentialName.trim() || `${design.result?.connector.label} Credential`;
      design.save(name, values, hcConfig);
    },
    [flow, credentialName, design.result, design.save, health.result, health.setResult],
  );

  const handleHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      if (!design.result) return;
      await health.checkDesign(
        instruction.trim() || design.result.connector.label,
        design.result.connector as unknown as Record<string, unknown>,
        values,
      );
    },
    [instruction, design.result, health.checkDesign],
  );

  const handleValuesChanged = useCallback(
    (_key: string, _value: string) => {
      health.invalidate();
      if (oauth.completedAt) oauth.reset();
    },
    [health.invalidate, oauth.completedAt, oauth.reset],
  );

  const handleOAuthConsent = useCallback(
    (values: Record<string, string>) => {
      if (flow.kind === 'provider_oauth') {
        const clientId = values.client_id?.trim();
        const clientSecret = values.client_secret?.trim();
        if (!clientId) return;
        universalOAuth.startConsent({
          providerId: flow.providerId,
          clientId,
          clientSecret: clientSecret || undefined,
          scopes: values.scopes?.trim() ? values.scopes.trim().split(/\s+/) : undefined,
        });
      } else {
        oauth.startConsent(design.result?.connector.name || 'google', values);
      }
    },
    [flow, design.result, oauth.startConsent, universalOAuth.startConsent],
  );

  const handleReset = useCallback(() => {
    design.reset();
    health.invalidate();
  }, [design.reset, health.invalidate]);

  const handleRefine = useCallback(() => {
    const preserved = instruction;
    design.reset();
    setInstruction(preserved);
    setCredentialName('');
    health.invalidate();
    setNegotiatorValues({});
  }, [instruction, design.reset, health.invalidate]);

  const startRefinement = useCallback(
    (refinementText: string) => {
      const text = refinementText.trim();
      if (!text) return;
      const prev = lastResultRef.current;
      const contextParts: string[] = [];
      if (prev) {
        contextParts.push(
          `Previously designed "${prev.connector.label}" (${prev.connector.name}) ` +
          `with fields: ${prev.connector.fields.map((f) => f.key).join(', ')}.`,
        );
        if (prev.summary) contextParts.push(`Summary: ${prev.summary}`);
      }
      if (instruction.trim()) {
        contextParts.push(`Original request: ${instruction.trim()}`);
      }
      contextParts.push(`Refinement: ${text}`);
      const enriched = contextParts.join('\n');
      setCredentialName('');
      health.invalidate();
      setNegotiatorValues({});
      oauth.reset();
      universalOAuth.reset();
      setRefinementCount((c) => c + 1);
      setInstruction(enriched);
      design.refine(enriched);
    },
    [instruction, design.refine, health.invalidate, oauth.reset, universalOAuth.reset],
  );

  const handleNegotiatorValues = useCallback(
    (values: Record<string, string>) => {
      setNegotiatorValues(values);
      health.invalidate();
    },
    [health.invalidate],
  );

  const resetAll = useCallback(() => {
    design.reset();
    oauth.reset();
    universalOAuth.reset();
    health.invalidate();
    setInstruction('');
    setCredentialName('');
    setNegotiatorValues({});
    setRefinementCount(0);
    lastResultRef.current = null;
    authPrefetchedRef.current = false;
    setPrefetchedAuthDetections(undefined);
  }, [design.reset, oauth.reset, universalOAuth.reset, health.invalidate]);

  // -- Context value --
  const contextValue: CredentialDesignContextValue | null = design.result
    ? buildContextValue({
        result: design.result,
        fields,
        effectiveFields,
        requiredCount,
        optionalCount,
        firstSetupUrl,
        credentialName,
        onCredentialNameChange: setCredentialName,
        flow,
        mergedOAuthValues,
        isAuthorizingOAuth: oauth.isAuthorizing || universalOAuth.isAuthorizing,
        oauthConsentCompletedAt: oauth.completedAt || universalOAuth.completedAt,
        isHealthchecking: health.isHealthchecking,
        healthcheckResult: health.result,
        oauthStatusMessage,
        canSaveCredential,
        lastSuccessfulTestAt: health.result?.lastSuccessfulTestAt ?? null,
        isSaving: design.isSaving,
        saveError: design.error,
        onSave: handleSave,
        onOAuthConsent: handleOAuthConsent,
        onHealthcheck: handleHealthcheck,
        onValuesChanged: handleValuesChanged,
        onReset: handleReset,
        onRefine: handleRefine,
        onNegotiatorValues: handleNegotiatorValues,
        prefetchedAuthDetections,
      })
    : null;

  return {
    contextValue,
    phase: design.phase,
    outputLines: design.outputLines,
    error: design.error,
    savedCredentialId: design.savedCredentialId,
    registeredConnectorName: design.registeredConnectorName,
    instruction,
    setInstruction,
    credentialName,
    start,
    cancel: design.cancel,
    resetAll,
    startRefinement,
    refinementCount,
    loadTemplate: design.loadTemplate,
    invalidateHealth: health.invalidate,
  };
}
