import { useMemo } from 'react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';
import {
  deriveCredentialFlow,
  getEffectiveFields,
  isSaveReady,
} from '@/features/vault/sub_design/CredentialDesignHelpers';

/**
 * Derives field definitions from the design result.
 */
export function useDesignFields(result: CredentialDesignResult | null) {
  const fields: CredentialTemplateField[] = useMemo(
    () =>
      result?.connector.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as CredentialTemplateField['type'],
        required: f.required,
        placeholder: f.placeholder,
        helpText: f.helpText,
      })) ?? [],
    [result],
  );

  const fieldKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

  const flow = useMemo(
    () => deriveCredentialFlow(result?.connector.oauth_type ?? null, fieldKeys),
    [result?.connector.oauth_type, fieldKeys],
  );

  const effectiveFields = useMemo(() => getEffectiveFields(fields, flow), [fields, flow]);

  const requiredCount = fields.filter((f) => f.required).length;
  const optionalCount = Math.max(0, fields.length - requiredCount);

  return { fields, fieldKeys, flow, effectiveFields, requiredCount, optionalCount };
}

/**
 * Validates effective fields and checks save-readiness.
 */
export function useFieldValidation(
  effectiveFields: CredentialTemplateField[],
  mergedOAuthValues: Record<string, string>,
  flow: ReturnType<typeof deriveCredentialFlow>,
  healthResult: { success?: boolean; healthcheckConfig?: Record<string, unknown> | null } | null,
) {
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
    healthResult?.success === true,
    healthResult?.healthcheckConfig ?? null,
  );

  return { hasFieldValidationErrors, canSaveCredential };
}
