// Production use-case picker — dual-mode (Cockpit view + Forge edit)
// card list with a Continue button footer. Accepts standard
// UseCasePickerVariantProps so MatrixAdoptionView can plumb real
// template data; falls back to fixture use cases for standalone demos.

import { AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useVaultStore } from '@/stores/vaultStore';
import {
  DEV_CLONE_FIXTURE_USE_CASES,
  FALLBACK_SAMPLE,
  SAMPLE_MESSAGE_BY_UC,
} from '../MessagingPickerShared';
import { QuickAddCredentialModal } from '../QuickAddCredentialModal';
import type {
  UseCaseOption,
  UseCasePickerVariantProps,
} from '../useCasePickerShared';
import { PreviewModal } from './ucPreviewModal';
import { UcCard } from './ucCard';
import { MESSAGING_CATEGORY } from './ucPickerTypes';
import { useUcPickerState } from './useUcPickerState';

export type { UseCaseOption } from '../useCasePickerShared';

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  // When the parent passes no use cases (e.g. standalone demo pages)
  // fall back to the fixture set so the picker still renders meaningful
  // content.
  const useCases: UseCaseOption[] =
    props.useCases && props.useCases.length > 0 ? props.useCases : DEV_CLONE_FIXTURE_USE_CASES;

  const state = useUcPickerState({
    useCases,
    selectedIds: props.selectedIds,
    triggerSelections: props.triggerSelections,
    onToggle: props.onToggle,
    onTriggerChange: props.onTriggerChange,
  });

  const selectedCount = useCases.filter((u) => state.enabled.has(u.id)).length;
  const canContinue = selectedCount > 0;

  const previewSample = state.previewUcId
    ? SAMPLE_MESSAGE_BY_UC[state.previewUcId] ?? FALLBACK_SAMPLE
    : null;
  const previewUc = state.previewUcId ? useCases.find((u) => u.id === state.previewUcId) : null;

  return (
    <>
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {useCases.map((uc) => (
            <UcCard key={uc.id} uc={uc} state={state} />
          ))}
        </div>

        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-3 border-t border-border bg-background">
          <span className="typo-caption text-foreground/55">
            {selectedCount} of {useCases.length} capabilit
            {useCases.length === 1 ? 'y' : 'ies'} enabled
          </span>
          <button
            type="button"
            onClick={props.onContinue}
            disabled={!canContinue}
            className="focus-ring inline-flex items-center gap-2 px-5 py-2 rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" /> Continue
          </button>
        </div>
      </div>

      {state.quickAddCtx && (
        <QuickAddCredentialModal
          category={MESSAGING_CATEGORY}
          categoryLabel="messaging channel"
          onCredentialAdded={(serviceType) => {
            void state
              .fetchCredentials()
              .then(() => {
                const added = useVaultStore
                  .getState()
                  .credentials.find(
                    (c) => c.service_type === serviceType && c.healthcheck_last_success === true,
                  );
                if (added && state.quickAddCtx) {
                  state.attachChannelAndRoute(added.id, state.quickAddCtx.ucId, state.quickAddCtx.eventType);
                }
              })
              .finally(() => state.setQuickAddCtx(null));
          }}
          onClose={() => state.setQuickAddCtx(null)}
        />
      )}

      <AnimatePresence>
        {state.previewUcId && previewSample && previewUc && (
          <PreviewModal
            title={previewSample.title}
            subtitle={`In-App Message preview · ${previewUc.name}`}
            onClose={() => state.setPreviewUcId(null)}
          >
            <MarkdownRenderer content={previewSample.body} className="typo-body leading-relaxed" />
          </PreviewModal>
        )}
      </AnimatePresence>
    </>
  );
}
