import { matchCredentialToConnector } from './connectorMatching';
import type { PersonaCredential } from '@/lib/types/types';

export type ConnectorHealth = 'ready' | 'missing' | 'failed';

export interface ConnectorRailItem {
  name: string;
  health: ConnectorHealth;
  credentialName: string | null;
  errorMessage: string | null;
}

export interface ConnectorHealthInput {
  name: string;
  has_credential?: boolean;
}

export function buildConnectorRailItems(
  connectors: ConnectorHealthInput[] | null | undefined,
  credentialLinks: Record<string, string>,
  credentials: PersonaCredential[],
): ConnectorRailItem[] {
  if (!connectors || connectors.length === 0) return [];

  return connectors.map((connector) => {
    const linkedCredentialId = credentialLinks[connector.name];
    const linkedCredential = linkedCredentialId
      ? credentials.find((credential) => credential.id === linkedCredentialId)
      : null;
    const matchedCredential = linkedCredential ?? matchCredentialToConnector(credentials, connector.name);
    const hasCredential = connector.has_credential || !!linkedCredentialId || !!matchedCredential;

    return {
      name: connector.name,
      health: hasCredential ? 'ready' : 'missing',
      credentialName: matchedCredential?.name ?? linkedCredentialId ?? null,
      errorMessage: null,
    };
  });
}
