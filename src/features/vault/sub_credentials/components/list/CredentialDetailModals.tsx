import { CredentialPlaygroundModal } from '@/features/vault/shared/playground/CredentialPlaygroundModal';
import { SchemaManagerModal } from '@/features/vault/sub_databases/SchemaManagerModal';
import { VectorKbModal } from '@/features/vault/shared/vector/VectorKbModal';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

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
  if (!selectedCredential) return null;

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

  return (
    <CredentialPlaygroundModal
      credential={selectedCredential}
      connector={selectedConnector}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}
