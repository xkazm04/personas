import { CredentialPlaygroundModal } from '@/features/vault/shared/playground/CredentialPlaygroundModal';
import { SchemaManagerModal } from '@/features/vault/sub_databases/SchemaManagerModal';
import { VectorKbModal } from '@/features/vault/shared/vector/VectorKbModal';
import { GatewayMembersModal } from '@/features/vault/sub_credentials/components/gateway/GatewayMembersModal';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useTier } from '@/hooks/utility/interaction/useTier';

interface CredentialDetailModalsProps {
  selectedCredential: CredentialMetadata | undefined;
  selectedConnector: ConnectorDefinition | undefined;
  selectedIsDatabase: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function CredentialDetailModals({
  selectedCredential,
  selectedConnector,
  selectedIsDatabase,
  onClose,
  onDelete,
}: CredentialDetailModalsProps) {
  const { isStarter: isSimple } = useTier();
  if (!selectedCredential) return null;

  // Simple mode: skip complex playground/schema/vector modals
  if (isSimple) return null;

  if (selectedIsDatabase && selectedCredential.service_type === 'personas_vector_db') {
    return (
      <VectorKbModal
        credential={selectedCredential}
        connector={selectedConnector}
        onClose={onClose}
      />
    );
  }

  if (selectedIsDatabase && selectedCredential.service_type !== 'personas_vector_db') {
    return (
      <SchemaManagerModal
        credential={selectedCredential}
        connector={selectedConnector}
        onClose={onClose}
      />
    );
  }

  // MCP gateway credentials open a membership management modal instead of
  // the playground — they have no healthcheck / tools of their own; everything
  // is delegated to their underlying members.
  if (selectedCredential.service_type === 'mcp_gateway') {
    return <GatewayMembersModal credential={selectedCredential} onClose={onClose} />;
  }

  return (
    <CredentialPlaygroundModal
      credential={selectedCredential}
      connector={selectedConnector}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}
