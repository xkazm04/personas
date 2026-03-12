import { CheckCircle2, KeyRound, ExternalLink } from 'lucide-react';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { PLATFORM_CONFIG } from '../libs/automationTypes';

interface CredentialStatusProps {
  platform: AutomationPlatform;
  needsCredential: boolean;
  hasPlatformCredential: boolean;
  platformCredentials: CredentialMetadata[];
  platformCredentialId: string | null;
  setPlatformCredentialId: (v: string | null) => void;
  platformConnector: { id: string } | null;
}

export function CredentialStatus({
  platform,
  needsCredential,
  hasPlatformCredential,
  platformCredentials,
  platformCredentialId,
  setPlatformCredentialId,
  platformConnector,
}: CredentialStatusProps) {
  if (!needsCredential) return null;

  if (!hasPlatformCredential) {
    return (
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-brand-amber/5 border border-brand-amber/15">
        <KeyRound className="w-4 h-4 text-brand-amber/70 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/80">
            {PLATFORM_CONFIG[platform]?.label} credentials required
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Add your {PLATFORM_CONFIG[platform]?.label} API key in the Vault to enable direct workflow management and deployment.
          </p>
          {platformConnector && (
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-vault-connector', { detail: { connectorId: platformConnector.id } }));
              }}
              className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-sm font-medium rounded-xl bg-brand-amber/15 border border-brand-amber/25 text-foreground/80 hover:bg-brand-amber/25 transition-colors"
            >
              <KeyRound className="w-3 h-3" />
              Add {PLATFORM_CONFIG[platform]?.label} Credentials
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-brand-emerald/5 border border-brand-emerald/15">
      <CheckCircle2 className="w-4 h-4 text-brand-emerald/70 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/80">
          <span className="font-medium text-brand-emerald">{PLATFORM_CONFIG[platform]?.label} connected</span>
          {' -- '}
          <span className="text-muted-foreground">{platformCredentials[0]?.name}</span>
        </p>
      </div>
      {platformCredentials.length > 1 && (
        <ThemedSelect
          value={platformCredentialId ?? ''}
          onValueChange={(v) => setPlatformCredentialId(v || null)}
          wrapperClassName="w-40"
        >
          {platformCredentials.map((c: CredentialMetadata) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </ThemedSelect>
      )}
    </div>
  );
}
