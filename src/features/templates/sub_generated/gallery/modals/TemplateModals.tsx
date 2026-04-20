import { ConnectorCredentialModal } from '@/features/vault/sub_credentials/components/forms/ConnectorCredentialModal';
import AdoptionWizardModal from '../../adoption/AdoptionWizardModal';
import { RebuildModal } from './RebuildModal';
import { TemplatePreviewModal } from './TemplatePreviewModal';
import { RecommendedModal } from './RecommendedModal';
import { CatalogCredentialModal } from './CatalogCredentialModal';
import type { TemplateModal } from '../cards/reviewParseCache';
import type { ModalStackActions } from './useModalStack';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { SuggestedConnector } from '@/lib/types/designTypes';
import type { useBackgroundRebuild } from '@/hooks/design/core/useBackgroundRebuild';
import type { useBackgroundPreview } from '@/hooks/design/core/useBackgroundPreview';

export interface CredentialModalTarget {
  connectorName: string;
  suggestedConnector: SuggestedConnector | null;
  connectorDefinition: ConnectorDefinition | null;
}

interface TemplateModalsProps {
  modals: ModalStackActions<TemplateModal>;
  /** @deprecated Kept for caller compatibility — no longer used internally */
  credentials?: CredentialMetadata[];
  /** @deprecated Kept for caller compatibility — no longer used internally */
  connectorDefinitions?: ConnectorDefinition[];
  onDeleteReview: (id: string) => Promise<void>;
  onPersonaCreated: () => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  rebuild: ReturnType<typeof useBackgroundRebuild>;
  preview: ReturnType<typeof useBackgroundPreview>;
  recommendedTemplates: PersonaDesignReview[];
  setExpandedRow: (id: string | null) => void;
  credentialModalTarget: CredentialModalTarget | null;
  onCredentialSave: (values: Record<string, string>) => Promise<void>;
  onCredentialModalClose: () => void;
}

export function TemplateModals({
  modals,
  onPersonaCreated,
  rebuild,
  preview,
  recommendedTemplates,
  setExpandedRow,
  credentialModalTarget,
  onCredentialSave,
  onCredentialModalClose,
}: TemplateModalsProps) {
  return (
    <>
      {/* Adoption Wizard Modal */}
      <AdoptionWizardModal
        isOpen={modals.isOpen('adopt')}
        onClose={() => modals.close('adopt')}
        review={modals.find('adopt')?.review ?? null}
        onPersonaCreated={onPersonaCreated}
      />

      {/* Rebuild Modal */}
      {modals.isOpen('rebuild') && (
        <RebuildModal
          isOpen
          onClose={() => modals.close('rebuild')}
          review={modals.find('rebuild')?.review ?? null}
          phase={rebuild.phase}
          lines={rebuild.lines}
          error={rebuild.error}
          onStartRebuild={(dir) => {
            const r = modals.find('rebuild')?.review;
            if (!r) return;
            rebuild.startRebuild(r.id, r.test_case_name, dir);
          }}
          onCancel={() => rebuild.cancelCurrentRebuild()}
        />
      )}

      {/* Template Preview Modal */}
      <TemplatePreviewModal
        isOpen={modals.isOpen('preview')}
        onClose={() => modals.close('preview')}
        review={modals.find('preview')?.review ?? null}
        phase={preview.phase}
        lines={preview.lines}
        error={preview.error}
        hasStarted={preview.hasStarted}
        onStartPreview={(rId, rName, draftJson) => preview.startPreview(rId, rName, draftJson)}
        onRetryPreview={(draftJson) => preview.retryPreview(draftJson)}
      />

      {/* Recommended Modal */}
      <RecommendedModal
        isOpen={modals.isOpen('recommended')}
        onClose={() => modals.close('recommended')}
        recommendedTemplates={recommendedTemplates}
        onSelectTemplate={(t) => {
          modals.close('recommended');
          setExpandedRow(t.id);
          modals.open({ type: 'detail', review: t });
        }}
      />

      {/* Connector Credential Modal */}
      {credentialModalTarget && credentialModalTarget.connectorDefinition ? (
        <CatalogCredentialModal
          connectorDefinition={credentialModalTarget.connectorDefinition}
          onSave={onCredentialSave}
          onClose={onCredentialModalClose}
        />
      ) : credentialModalTarget ? (
        <ConnectorCredentialModal
          connector={
            credentialModalTarget.suggestedConnector ?? {
              name: credentialModalTarget.connectorName,
            }
          }
          connectorDefinition={undefined}
          existingCredential={undefined}
          onSave={onCredentialSave}
          onClose={onCredentialModalClose}
        />
      ) : null}
    </>
  );
}
