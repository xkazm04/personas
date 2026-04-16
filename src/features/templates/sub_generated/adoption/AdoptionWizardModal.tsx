import { useState, useCallback, useEffect } from 'react';
import { X, Grid3X3 } from 'lucide-react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { MatrixAdoptionView } from './MatrixAdoptionView';
import { BaseModal } from '../shared/BaseModal';
import {
  ConfirmDestructiveModal,
  type ConfirmDestructiveConfig,
} from '@/features/shared/components/overlays/ConfirmDestructiveModal';

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  onPersonaCreated: () => void;
}

/** Phases where the user has not yet done meaningful work. */
const SAFE_CLOSE_PHASES = new Set(['initializing', 'promoted', 'cancelled', 'failed']);

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  const [confirmConfig, setConfirmConfig] = useState<ConfirmDestructiveConfig | null>(null);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const buildSessionId = useAgentStore((s) => s.buildSessionId);

  // Reset any stale build-session state when the adoption modal opens. Without
  // this, a leftover buildSessionId from a previous adoption would trigger the
  // "Discard adoption progress?" confirmation when the user tries to close
  // the questionnaire — but the confirmation is invisible (stacked below the
  // questionnaire portal), leaving the close button effectively broken.
  useEffect(() => {
    if (isOpen) {
      useAgentStore.getState().resetBuildSession();
    }
  }, [isOpen]);

  const handleCloseAttempt = useCallback(() => {
    // No active build session or phase is safe to close — skip confirmation
    if (!buildSessionId || SAFE_CLOSE_PHASES.has(buildPhase)) {
      onClose();
      return;
    }

    setConfirmConfig({
      title: 'Discard adoption progress?',
      message: 'You have unsaved work in this adoption wizard. Closing now will discard your progress.',
      confirmLabel: 'Discard & Close',
      onConfirm: () => {
        setConfirmConfig(null);
        // Clean up the draft persona and build session — mirrors
        // MatrixAdoptionView.handleDeleteDraft so we don't leave orphaned
        // agents in the database when the user discards via the X button.
        const agent = useAgentStore.getState();
        const sys = useSystemStore.getState();
        const pid = agent.buildPersonaId;
        if (pid) {
          void agent.deletePersona(pid).catch(() => { /* best-effort */ });
        }
        agent.resetBuildSession();
        void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
          useOverviewStore.getState().processEnded('template_adopt', 'failed', pid ?? 'unknown');
        }).catch(() => {});
        sys.setTemplateAdoptActive(false);
        sys.setAdoptionDraft(null);
        onClose();
      },
      onCancel: () => {
        setConfirmConfig(null);
      },
    });
  }, [buildPhase, buildSessionId, onClose]);

  if (!isOpen || !review) return null;

  return (
    <BaseModal
      isOpen
      onClose={handleCloseAttempt}
      titleId="adoption-matrix-title"
      maxWidthClass="max-w-[1750px]"
      panelClassName="h-[92vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col"
      portal
    >
      <div className="relative h-full overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Grid3X3 className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 id="adoption-matrix-title" className="text-sm font-semibold text-foreground/90">
                Adopt Template
              </h2>
              <p className="text-[11px] text-foreground">{review.test_case_name}</p>
            </div>
          </div>
          <button
            onClick={handleCloseAttempt}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <MatrixAdoptionView
          review={review}
          onClose={handleCloseAttempt}
          onPersonaCreated={onPersonaCreated}
        />
      </div>
      <ConfirmDestructiveModal
        open={!!confirmConfig}
        config={confirmConfig}
      />
    </BaseModal>
  );
}
