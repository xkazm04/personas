import { Wrench } from 'lucide-react';
import { CredentialEventConfig } from '@/features/vault/sub_credentials/components/features/CredentialEventConfig';
import { CredentialIntelligence } from '@/features/vault/sub_credentials/components/features/CredentialIntelligence';
import { CredentialRotationSection } from '@/features/vault/sub_credentials/components/features/CredentialRotationSection';
import { OAuthTokenMetricsPanel } from '@/features/vault/sub_credentials/components/features/OAuthTokenMetricsPanel';
import { CredentialAuditTimeline } from '@/features/vault/sub_credentials/components/features/CredentialAuditTimeline';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { RotationStatus } from '@/api/vault/rotation';

type ExpandedSection = 'services' | 'events' | 'intelligence' | 'rotation' | 'token_lifetime' | 'audit';

interface CredentialSectionContentProps {
  expandedSection: ExpandedSection;
  credential: CredentialMetadata;
  connector: ConnectorDefinition;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  fetchRotationStatus: () => Promise<void>;
  onHealthcheck: () => void;
}

export function CredentialSectionContent({
  expandedSection,
  credential,
  connector,
  rotationStatus,
  rotationCountdown,
  fetchRotationStatus,
  onHealthcheck,
}: CredentialSectionContentProps) {
  return (
    <div className="bg-secondary/10 border border-primary/6 rounded-modal p-4">
      {expandedSection === 'services' && (
        <div className="space-y-2">
          {connector.services.map((service) => (
            <div
              key={service.toolName}
              className="flex items-center gap-3 p-3 bg-secondary/20 border border-primary/10 rounded-modal border-l-2"
              style={{ borderLeftColor: connector.color || 'transparent' }}
            >
              <Wrench className="w-3.5 h-3.5 text-foreground" />
              <div>
                <span className="text-sm text-foreground">{service.label}</span>
                <span className="ml-2 text-sm font-mono text-foreground">{service.toolName}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {expandedSection === 'events' && (
        <CredentialEventConfig credentialId={credential.id} events={connector.events} />
      )}
      {expandedSection === 'intelligence' && (
        <CredentialIntelligence credentialId={credential.id} />
      )}
      {expandedSection === 'rotation' && (
        <CredentialRotationSection
          credentialId={credential.id}
          rotationStatus={rotationStatus}
          rotationCountdown={rotationCountdown}
          isOAuth={
            (credential.oauth_token_expires_at != null) ||
            (credential.oauth_refresh_count > 0)
          }
          onRefresh={fetchRotationStatus}
          onHealthcheck={onHealthcheck}
        />
      )}
      {expandedSection === 'token_lifetime' && (
        <OAuthTokenMetricsPanel credentialId={credential.id} />
      )}
      {expandedSection === 'audit' && (
        <CredentialAuditTimeline credentialId={credential.id} />
      )}
    </div>
  );
}
