import { PersonaUseCasesTabGrid } from './PersonaUseCasesTabGrid';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function PersonaUseCasesTab(props: PersonaUseCasesTabProps) {
  return <PersonaUseCasesTabGrid {...props} />;
}
