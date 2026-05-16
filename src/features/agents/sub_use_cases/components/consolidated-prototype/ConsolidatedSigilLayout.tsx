import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { getMemoryCount } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import type { CredentialMetadata } from '@/lib/types/types';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';
import { CapabilityDisableDialog } from '../core/CapabilityDisableDialog';
import { UseCaseDetailExpanded } from '../recipes-prototype/shared/UseCaseDetailExpanded';
import {
  toDisplayUseCase,
  type DisplayUseCase,
} from '../recipes-prototype/shared/displayUseCase';
import { ConsolidatedPersonaHero } from './ConsolidatedPersonaHero';
import { ConsolidatedUseCaseRow } from './ConsolidatedUseCaseRow';

interface ConsolidatedSigilLayoutProps {
  credentials: CredentialMetadata[];
}

const HERO_MAX_WIDTH = 960;

/**
 * Prototype consolidated view: persona-level hero band at the top with a
 * list of capability rows below. Behavior parity for run / pause / open
 * detail / disable-confirmation is preserved against RecipesVariantSigilGrid;
 * defers model-strip + policy-toggles to the detail view to keep the row
 * layout legible at the consolidated scale.
 *
 * Behind a tab switch in PersonaUseCasesTab so it does not affect the
 * default capability surface.
 */
export function ConsolidatedSigilLayout({ credentials }: ConsolidatedSigilLayoutProps) {
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

  const handleToggle = (uc: DisplayUseCase) => {
    if (!personaId) return;
    requestToggle(personaId, uc.id, uc.title, uc.health === 'disabled');
  };
  const handleSimulate = (uc: DisplayUseCase) => {
    if (!personaId) return;
    requestSimulate(personaId, uc.id);
  };
  const handleRun = (uc: DisplayUseCase) => {
    handleExecute(uc.id, uc.raw.sample_input ?? undefined);
  };

  if (!selectedPersona) {
    return (
      <EmptyState
        title={t.agents.use_cases.no_persona_selected_title}
        description={t.agents.use_cases.no_persona_selected_desc}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="popLayout" initial={false}>
        {activeUc ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 min-h-0 flex flex-col"
          >
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
              onToggle={() => handleToggle(activeUc)}
              onRun={() => handleRun(activeUc)}
              onSimulate={() => handleSimulate(activeUc)}
              onRerun={handleRerun}
            />
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-1 min-h-0 flex flex-col"
          >
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              <div
                className="mx-auto px-4 py-4 flex flex-col gap-4"
                style={{ maxWidth: HERO_MAX_WIDTH }}
              >
                <ConsolidatedPersonaHero
                  personaName={selectedPersona.name ?? ''}
                  useCases={items}
                />

                {items.length === 0 ? (
                  <EmptyState variant="use-cases-empty" />
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="typo-label uppercase tracking-[0.18em] text-foreground/55 px-1">
                      {t.agents.use_cases.consolidated_capabilities_heading}
                    </span>
                    <div className="flex flex-col gap-2">
                      {items.map((uc) => (
                        <ConsolidatedUseCaseRow
                          key={uc.id}
                          uc={uc}
                          isPendingToggle={pendingUseCaseId === uc.id}
                          onOpen={() => setSelectedUseCaseId(uc.id)}
                          onToggle={() => handleToggle(uc)}
                          onRun={() => handleRun(uc)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {disableConfirmation && personaId && (
        <CapabilityDisableDialog
          state={disableConfirmation}
          onConfirm={() => confirmDisable(personaId)}
          onCancel={cancelDisable}
        />
      )}
    </div>
  );
}
