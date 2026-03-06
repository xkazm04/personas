import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useCredentialDesign, type CredentialDesignResult, type CredentialDesignPhase } from '@/hooks/design/useCredentialDesign';
import { useOAuthConsent } from '@/hooks/design/useOAuthConsent';
import { useUniversalOAuth } from '@/hooks/design/useUniversalOAuth';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import type { CredentialTemplateField } from '@/lib/types/types';
import {
  extractFirstUrl,
  deriveCredentialFlow,
  getEffectiveFields,
  isSaveReady,
} from '@/features/vault/sub_design/CredentialDesignHelpers';
import type { CredentialDesignContextValue } from '@/features/vault/sub_design/CredentialDesignContext';

// ── Return type ─────────────────────────────────────────────────────

export interface CredentialDesignOrchestrator {
  /** Ready-made context value for CredentialDesignProvider (null before result). */
  contextValue: CredentialDesignContextValue | null;

  // Phase machine
  phase: CredentialDesignPhase;
  outputLines: string[];
  error: string | null;
  savedCredentialId: string | null;

  // Instruction / name
  instruction: string;
  setInstruction: (v: string) => void;
  credentialName: string;

  // Actions
  start: (override?: string) => void;
  cancel: () => void;
  resetAll: () => void;

  /** Additive refinement: restart design with context from previous result. */
  startRefinement: (refinementText: string) => void;
  /** How many refinement rounds have been applied in this session. */
  refinementCount: number;

  // Template support
  loadTemplate: (template: CredentialDesignResult) => void;
  invalidateHealth: () => void;
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Composes useCredentialDesign, useOAuthConsent, useUniversalOAuth, and
 * useCredentialHealth into a single orchestrator that returns a ready-made
 * CredentialDesignContextValue plus the extra state the modal needs.
 *
 * All OAuth/healthcheck synchronisation, field derivation, flow detection,
 * and handler wiring happens here — the parent component only renders.
 */
export function useCredentialDesignOrchestrator(): CredentialDesignOrchestrator {
  // ── Sub-hooks ──────────────────────────────────────────────────────

  const design = useCredentialDesign();
  const oauth = useOAuthConsent();
  const universalOAuth = useUniversalOAuth();
  const health = useCredentialHealth('design');

  // ── Local state ────────────────────────────────────────────────────

  const [instruction, setInstruction] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [negotiatorValues, setNegotiatorValues] = useState<Record<string, string>>({});
  const [refinementCount, setRefinementCount] = useState(0);
  const lastResultRef = useRef<CredentialDesignResult | null>(null);

  // Snapshot the result whenever we get one, so it survives phase transitions to 'done'
  useEffect(() => {
    if (design.result) lastResultRef.current = design.result;
  }, [design.result]);

  // ── Sync OAuth messages → healthcheck result ───────────────────────

  useEffect(() => {
    if (oauth.message) health.setResult(oauth.message);
  }, [oauth.message, health.setResult]);

  useEffect(() => {
    if (universalOAuth.message) health.setResult(universalOAuth.message);
  }, [universalOAuth.message, health.setResult]);

  // ── Auto-set credential name when preview arrives ──────────────────

  useEffect(() => {
    if (design.phase === 'preview' && design.result) {
      setCredentialName((prev) => prev || `${design.result!.connector.label} Credential`);
    }
  }, [design.phase, design.result]);

  // ── Derived values ─────────────────────────────────────────────────

  const fields: CredentialTemplateField[] = useMemo(
    () =>
      design.result?.connector.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        required: f.required,
        placeholder: f.placeholder,
        helpText: f.helpText,
      })) ?? [],
    [design.result],
  );

  const fieldKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

  const flow = useMemo(
    () => deriveCredentialFlow(design.result?.connector.oauth_type ?? null, fieldKeys),
    [design.result?.connector.oauth_type, fieldKeys],
  );

  const effectiveFields = useMemo(() => getEffectiveFields(fields, flow), [fields, flow]);

  const firstSetupUrl = extractFirstUrl(design.result?.setup_instructions);
  const requiredCount = fields.filter((f) => f.required).length;
  const optionalCount = Math.max(0, fields.length - requiredCount);

  // Read OAuth values from refs (not React state) to avoid DevTools exposure.
  // The valuesVersion counters trigger re-computation when tokens arrive.
  const mergedOAuthValues = useMemo(
    () => ({ ...oauth.getValues(), ...universalOAuth.getValues(), ...negotiatorValues }),
    [oauth.valuesVersion, universalOAuth.valuesVersion, negotiatorValues],
  );

  const hasFieldValidationErrors = useMemo(() => {
    return effectiveFields.some((field) => {
      const value = mergedOAuthValues[field.key] ?? '';
      const trimmed = value.trim();
      if (field.required && !trimmed) return true;
      if (trimmed && field.type === 'url') {
        try {
          const parsed = new URL(trimmed);
          return !['http:', 'https:'].includes(parsed.protocol);
        } catch {
          return true;
        }
      }
      return false;
    });
  }, [effectiveFields, mergedOAuthValues]);

  const canSaveCredential = !hasFieldValidationErrors && isSaveReady(
    flow,
    mergedOAuthValues,
    health.result?.success === true,
    health.result?.healthcheckConfig ?? null,
  );

  // ── Handlers ───────────────────────────────────────────────────────

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

  /**
   * Additive refinement: compose a context-enriched prompt from the previous
   * design result + the user's refinement text, then restart the design stream.
   * Keeps savedCredentialId intact and increments the refinement counter.
   */
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

      // Clear transient state but keep savedCredentialId (via design.refine)
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

  /** Full reset — call when modal opens or user starts over. */
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
  }, [design.reset, oauth.reset, universalOAuth.reset, health.invalidate]);

  // ── Context value ──────────────────────────────────────────────────

  const contextValue: CredentialDesignContextValue | null = design.result
    ? {
        result: design.result,
        fields,
        effectiveFields,
        requiredCount,
        optionalCount,
        firstSetupUrl,
        credentialName,
        onCredentialNameChange: setCredentialName,
        credentialFlow: flow,
        oauthInitialValues: mergedOAuthValues,
        isAuthorizingOAuth: oauth.isAuthorizing || universalOAuth.isAuthorizing,
        oauthConsentCompletedAt: oauth.completedAt || universalOAuth.completedAt,
        isHealthchecking: health.isHealthchecking,
        healthcheckResult: health.result,
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
      }
    : null;

  return {
    contextValue,
    phase: design.phase,
    outputLines: design.outputLines,
    error: design.error,
    savedCredentialId: design.savedCredentialId,
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
