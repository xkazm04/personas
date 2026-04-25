import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSystemStore } from '@/stores/systemStore';
import { TIERS } from '@/lib/constants/uiModes';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import type { SimpleTab } from '@/stores/slices/system/simpleModeSlice';

import { SimpleHomeShell } from './components/SimpleHomeShell';
import { GraduateToPowerModal } from './components/GraduateToPowerModal';
import { CATEGORIES } from './hooks/useIllustration';

// Variants are lazy-loaded so switching tabs only fetches the chunk you need.
// Each variant is an empty placeholder in this phase; Phases 07/08/09 wire
// real data.
const loadMosaic = () => import('./components/variants/MosaicVariant');
const loadConsole = () => import('./components/variants/ConsoleVariant');
const loadInbox = () => import('./components/variants/InboxVariant');
const MosaicVariant = lazy(loadMosaic);
const ConsoleVariant = lazy(loadConsole);
const InboxVariant = lazy(loadInbox);

type IdleCb = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
type IdleScheduler = (cb: IdleCb, opts?: { timeout?: number }) => number;

function onIdle(cb: () => void): () => void {
  const g = globalThis as unknown as { requestIdleCallback?: IdleScheduler; cancelIdleCallback?: (h: number) => void };
  if (typeof g.requestIdleCallback === 'function') {
    const h = g.requestIdleCallback(() => cb(), { timeout: 2000 });
    return () => g.cancelIdleCallback?.(h);
  }
  const h = setTimeout(cb, 0);
  return () => clearTimeout(h);
}

function variantFor(tab: SimpleTab) {
  switch (tab) {
    case 'mosaic':
      return <MosaicVariant />;
    case 'console':
      return <ConsoleVariant />;
    case 'inbox':
      return <InboxVariant />;
  }
}

/**
 * Full-viewport Simple-mode Home Base. Rendered by PersonasPage when
 * `viewMode === TIERS.STARTER`; see the routing fork there. Power-mode
 * components do not mount under this page — the sidebar and section
 * router short-circuit before this component renders.
 *
 * The top bar lets the user graduate back to Power (either to Home or
 * into Settings); the tab switcher persists its selection in the system
 * store so Simple↔Power toggles remember where you were.
 *
 * Phase 12: the "Switch to Power" action is gated behind a confirmation
 * modal (`GraduateToPowerModal`). The Settings gear path stays direct —
 * users can always reach settings without confirmation.
 */
export default function SimpleHomePage() {
  const { activeSimpleTab, setActiveSimpleTab, setViewMode, setSidebarSection } = useSystemStore(
    useShallow((s) => ({
      activeSimpleTab: s.activeSimpleTab,
      setActiveSimpleTab: s.setActiveSimpleTab,
      setViewMode: s.setViewMode,
      setSidebarSection: s.setSidebarSection,
    })),
  );

  const [graduateOpen, setGraduateOpen] = useState(false);

  // Preload the 12 category PNGs + warm sibling variant chunks on first mount.
  // Both run during idle time so they never compete with first paint.
  useEffect(() => {
    return onIdle(() => {
      for (const cat of CATEGORIES) {
        const img = new Image();
        img.src = `/illustrations/simple-mode/category-${cat}.png`;
      }
      void loadMosaic();
      void loadConsole();
      void loadInbox();
    });
  }, []);

  const handleOpenGraduate = useCallback(() => {
    setGraduateOpen(true);
  }, []);

  const handleCancelGraduate = useCallback(() => {
    setGraduateOpen(false);
  }, []);

  const handleConfirmGraduate = useCallback(() => {
    setViewMode(TIERS.TEAM);
    setSidebarSection('home');
    setGraduateOpen(false);
  }, [setViewMode, setSidebarSection]);

  const onOpenSettings = useCallback(() => {
    // Direct — no modal gate per Phase 12 user decision.
    setViewMode(TIERS.TEAM);
    setSidebarSection('settings');
  }, [setViewMode, setSidebarSection]);

  return (
    <ErrorBoundary name="SimpleHome">
      <div className="h-screen flex flex-col bg-background text-foreground simple-min-width">
        <SimpleHomeShell
          activeTab={activeSimpleTab}
          onTabChange={setActiveSimpleTab}
          onSwitchToPower={handleOpenGraduate}
          onOpenSettings={onOpenSettings}
        >
          <Suspense fallback={null}>{variantFor(activeSimpleTab)}</Suspense>
        </SimpleHomeShell>
        <GraduateToPowerModal
          isOpen={graduateOpen}
          onConfirm={handleConfirmGraduate}
          onCancel={handleCancelGraduate}
        />
      </div>
    </ErrorBoundary>
  );
}
