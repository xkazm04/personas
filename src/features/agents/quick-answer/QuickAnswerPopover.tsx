// QuickAnswerPopover — the app-size triage surface for everything waiting on a
// human. Mounted from the title-bar dock's TrayOverlays when
// headerOverlay === 'quick-answer'.
//
// It used to be a 576px anchored panel over two queues (build questions +
// persona reviews). It is now a full-app deck over FOUR: persona manual
// reviews, backlog ideas, workspace practices and build questions, unified by
// `triage/triageTypes` and fed by `triage/useUnifiedTriage`.
//
// The exported name and props are unchanged, so `TrayOverlays` never learned
// about any of this. `QuickAnswerBody` and its children are deliberately NOT
// deleted — the channel-timeline rail and the reviews rail still render them.

import { lazy, Suspense } from 'react';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { useUnifiedTriage } from './triage/useUnifiedTriage';
import { useTriageCopy } from './triage/useTriageCopy';

// Lazy: the deck pulls in framer drag machinery and the markdown renderer, and
// most sessions never open it.
const TriageDeckVariant = lazy(() =>
  import('./triage/TriageDeckVariant').then((m) => ({ default: m.TriageDeckVariant })),
);

interface QuickAnswerPopoverProps {
  onClose: () => void;
  onOpenMonitor: () => void;
}

export function QuickAnswerPopover({ onClose, onOpenMonitor }: QuickAnswerPopoverProps) {
  const { t } = useTranslation();
  const copy = useTriageCopy();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  // Deep-link for questions that need the full builder (connector picker or
  // file attach) — mirrors QuickAnswerBody's openBuilder.
  const openBuilder = (personaId: string) => {
    setSidebarSection('personas');
    setEditorTab('matrix' as Parameters<typeof setEditorTab>[0]);
    selectPersona(personaId);
    onClose();
  };

  const queue = useUnifiedTriage(copy, openBuilder);

  return (
    <Suspense fallback={null}>
      <TriageDeckVariant
        queue={queue}
        title={t.monitor.quick_title}
        onOpenMonitor={onOpenMonitor}
        onClose={onClose}
      />
    </Suspense>
  );
}

export default QuickAnswerPopover;
