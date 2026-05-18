import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { getMemoryCount } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { AddCapabilityRow, PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { useSystemStore } from '@/stores/systemStore';
import type { CredentialMetadata } from '@/lib/types/types';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';
import { CapabilityDisableDialog } from '../core/CapabilityDisableDialog';
import { UseCaseDetailExpanded } from '../recipes-prototype/shared/UseCaseDetailExpanded';
import { TilePolicyToggles } from '../recipes-prototype/shared/TilePolicyToggles';
import {
  toDisplayUseCase,
  type DisplayUseCase,
} from '../recipes-prototype/shared/displayUseCase';

interface PersonaLayoutViewProps {
  credentials: CredentialMetadata[];
}

/**
 * View-mode wrapper around the shared PersonaLayout. Owns the
 * use-cases-tab hooks, derives DisplayUseCase[] from the persona's design
 * context, and supplies UseCaseDetailExpanded as the detail node when a
 * row is selected. The disable-confirmation dialog also lives here.
 *
 * The shared layout itself is mode-agnostic and lives under
 * src/features/shared/glyph/persona-layout/. Adoption + scratch wrappers
 * compose the same layout with mode-specific data sources.
 */
export function PersonaLayoutView({ credentials }: PersonaLayoutViewProps) {
  const { t } = useTranslation();
  const {
    selectedPersona,
    isExecuting,
    personaId,
    useCases: rawUseCases,
    selectedUseCaseId,
    setSelectedUseCaseId,
    historyRefreshKey,
    handleExecute,
    handleRerun,
  } = useUseCasesTab();
  const {
    pendingUseCaseId,
    disableConfirmation,
    requestToggle,
    confirmDisable,
    cancelDisable,
    requestSimulate,
  } = useCapabilityToggle();

  // Open Templates → Recipes catalog. The selected persona stays
  // anchored (agentStore is independent of the sidebar section), so
  // adoption from the catalog lands back in this Use Cases tab — same
  // navigation pattern the legacy SigilGrid's "recipe" empty-tile uses.
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  const openRecipeCatalog = () => {
    setSidebarSection('design-reviews');
    setTemplateTab('recipes');
  };

  const [memoriesDefault, setMemoriesDefault] = useState(true);
  const [reviewsDefault, setReviewsDefault] = useState(true);
  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    Promise.all([
      getMemoryCount(personaId).catch(() => 0),
      listManualReviews(personaId).then((rs) => rs.length).catch(() => 0),
    ]).then(([memCount, revCount]) => {
      if (cancelled) return;
      setMemoriesDefault(memCount > 0);
      setReviewsDefault(revCount > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  const credentialLinks = useSelectedCredentialLinks();
  const personaConnectors = useMemo(
    () => new Set(Object.keys(credentialLinks ?? {})),
    [credentialLinks],
  );

  const items = useMemo<DisplayUseCase[]>(
    () => rawUseCases.map((u) => toDisplayUseCase(u, { personaConnectors })),
    [rawUseCases, personaConnectors],
  );

  const activeUc = selectedUseCaseId
    ? items.find((u) => u.id === selectedUseCaseId) ?? null
    : null;

  if (!selectedPersona) {
    return (
      <EmptyState
        title={t.agents.use_cases.no_persona_selected_title}
        description={t.agents.use_cases.no_persona_selected_desc}
      />
    );
  }

  const detailNode = activeUc ? (
    <UseCaseDetailExpanded
      uc={activeUc}
      personaId={personaId}
      credentials={credentials}
      memoriesDefault={memoriesDefault}
      reviewsDefault={reviewsDefault}
      isExecuting={isExecuting}
      isThisExecuting={isExecuting && selectedUseCaseId === activeUc.id}
      pendingToggleId={pendingUseCaseId}
      historyRefreshKey={historyRefreshKey}
      onBack={() => setSelectedUseCaseId(null)}
      onToggle={() => {
        if (!personaId) return;
        requestToggle(personaId, activeUc.id, activeUc.title, activeUc.health === 'disabled');
      }}
      onRun={() => handleExecute(activeUc.id, activeUc.raw.sample_input ?? undefined)}
      onSimulate={() => {
        if (!personaId) return;
        requestSimulate(personaId, activeUc.id);
      }}
      onRerun={handleRerun}
    />
  ) : null;

  return (
    <>
      <PersonaLayout
        mode="view"
        personaName={selectedPersona.name ?? ''}
        items={items}
        selectedItemId={selectedUseCaseId}
        pendingToggleId={pendingUseCaseId}
        onRowOpen={(uc) => setSelectedUseCaseId(uc.id)}
        onRowToggle={(uc) => {
          if (!personaId) return;
          requestToggle(personaId, uc.id, uc.title, uc.health === 'disabled');
        }}
        onRowRun={(uc) => handleExecute(uc.id, uc.raw.sample_input ?? undefined)}
        renderRowPolicySlot={
          personaId
            ? (uc) => (
                <TilePolicyToggles
                  personaId={personaId}
                  uc={uc}
                  memoriesDefault={memoriesDefault}
                  reviewsDefault={reviewsDefault}
                />
              )
            : undefined
        }
        appendRow={<AddCapabilityRow onClick={openRecipeCatalog} />}
        detailNode={detailNode}
        emptyNode={<EmptyState variant="use-cases-empty" />}
      />

      {disableConfirmation && personaId && (
        <CapabilityDisableDialog
          state={disableConfirmation}
          onConfirm={() => confirmDisable(personaId)}
          onCancel={cancelDisable}
        />
      )}
    </>
  );
}
