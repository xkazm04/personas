import { createContext, useContext, type ReactNode } from 'react';
import type { CredentialTemplateField } from '@/lib/types/types';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import type { CredentialFlow } from './CredentialDesignHelpers';

// ── Context value ────────────────────────────────────────────────

export interface CredentialDesignContextValue {
  // Design result
  result: CredentialDesignResult;
  fields: CredentialTemplateField[];
  effectiveFields: CredentialTemplateField[];
  requiredCount: number;
  optionalCount: number;
  firstSetupUrl: string | null;

  // Credential name
  credentialName: string;
  onCredentialNameChange: (name: string) => void;

  // Credential flow (discriminated union replacing triple-OAuth booleans)
  credentialFlow: CredentialFlow;
  oauthInitialValues: Record<string, string>;
  isAuthorizingOAuth: boolean;
  oauthConsentCompletedAt: string | null;

  // Healthcheck state
  isHealthchecking: boolean;
  healthcheckResult: { success: boolean; message: string } | null;
  canSaveCredential: boolean;
  lastSuccessfulTestAt: string | null;

  // Save error (set when save fails and phase returns to preview)
  saveError: string | null;

  // Actions
  onSave: (values: Record<string, string>) => void;
  onOAuthConsent?: (values: Record<string, string>) => void;
  onHealthcheck: (values: Record<string, string>) => void;
  onValuesChanged: (key: string, value: string) => void;
  onReset: () => void;
  onRefine?: () => void;
  onNegotiatorValues?: (capturedValues: Record<string, string>) => void;
}

const CredentialDesignContext = createContext<CredentialDesignContextValue | null>(null);

// ── Hook ─────────────────────────────────────────────────────────

export function useCredentialDesignContext(): CredentialDesignContextValue {
  const ctx = useContext(CredentialDesignContext);
  if (!ctx) {
    throw new Error('useCredentialDesignContext must be used within a CredentialDesignProvider');
  }
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────

interface ProviderProps {
  value: CredentialDesignContextValue;
  children: ReactNode;
}

export function CredentialDesignProvider({ value, children }: ProviderProps) {
  return (
    <CredentialDesignContext.Provider value={value}>
      {children}
    </CredentialDesignContext.Provider>
  );
}
