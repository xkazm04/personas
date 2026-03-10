import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { AdoptionWizardProvider } from './AdoptionWizardContext';
import { AdoptionWizardInner } from './AdoptionWizardInner';

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
}

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  if (!isOpen) return null;

  return (
    <AdoptionWizardProvider
      isOpen={isOpen}
      review={review}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      onPersonaCreated={onPersonaCreated}
    >
      <AdoptionWizardInner onClose={onClose} />
    </AdoptionWizardProvider>
  );
}
