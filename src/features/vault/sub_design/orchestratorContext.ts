import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';
import type { CredentialDesignContextValue } from '@/features/vault/sub_design/CredentialDesignContext';
import type { deriveCredentialFlow } from '@/features/vault/sub_design/CredentialDesignHelpers';

interface ContextBuildInput {
  result: CredentialDesignResult;
  fields: CredentialTemplateField[];
  effectiveFields: CredentialTemplateField[];
  requiredCount: number;
  optionalCount: number;
  firstSetupUrl: string | null;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  flow: ReturnType<typeof deriveCredentialFlow>;
  mergedOAuthValues: Record<string, string>;
  isAuthorizingOAuth: boolean;
  oauthConsentCompletedAt: string | null;
  isHealthchecking: boolean;
  healthcheckResult: { success: boolean; message: string } | null;
  oauthStatusMessage: { success: boolean; message: string } | null;
  canSaveCredential: boolean;
  lastSuccessfulTestAt: string | null;
  isSaving: boolean;
  saveError: string | null;
  onSave: (values: Record<string, string>) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onHealthcheck: (values: Record<string, string>) => Promise<void>;
  onValuesChanged: (key: string, value: string) => void;
  onReset: () => void;
  onRefine: () => void;
  onNegotiatorValues: (values: Record<string, string>) => void;
}

export function buildContextValue(input: ContextBuildInput): CredentialDesignContextValue {
  return {
    result: input.result,
    fields: input.fields,
    effectiveFields: input.effectiveFields,
    requiredCount: input.requiredCount,
    optionalCount: input.optionalCount,
    firstSetupUrl: input.firstSetupUrl,
    credentialName: input.credentialName,
    onCredentialNameChange: input.onCredentialNameChange,
    credentialFlow: input.flow,
    oauthInitialValues: input.mergedOAuthValues,
    isAuthorizingOAuth: input.isAuthorizingOAuth,
    oauthConsentCompletedAt: input.oauthConsentCompletedAt,
    isHealthchecking: input.isHealthchecking,
    healthcheckResult: input.healthcheckResult,
    oauthStatusMessage: input.oauthStatusMessage,
    canSaveCredential: input.canSaveCredential,
    lastSuccessfulTestAt: input.lastSuccessfulTestAt,
    isSaving: input.isSaving,
    saveError: input.saveError,
    onSave: input.onSave,
    onOAuthConsent: input.onOAuthConsent,
    onHealthcheck: input.onHealthcheck,
    onValuesChanged: input.onValuesChanged,
    onReset: input.onReset,
    onRefine: input.onRefine,
    onNegotiatorValues: input.onNegotiatorValues,
  };
}
