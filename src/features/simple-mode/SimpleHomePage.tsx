import { lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSystemStore } from '@/stores/systemStore';
import { TIERS } from '@/lib/constants/uiModes';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import type { SimpleTab } from '@/stores/slices/system/simpleModeSlice';

import { SimpleHomeShell } from './components/SimpleHomeShell';

// Variants are lazy-loaded so switching tabs only fetches the chunk you need.
// Each variant is an empty placeholder in this phase; Phases 07/08/09 wire
// real data.
const MosaicVariant = lazy(() => import('./components/variants/MosaicVariant'));
const ConsoleVariant = lazy(() => import('./components/variants/ConsoleVariant'));
const InboxVariant = lazy(() => import('./components/variants/InboxVariant'));

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

  const onSwitchToPower = () => {
    setViewMode(TIERS.TEAM);
    setSidebarSection('home');
  };

  const onOpenSettings = () => {
    setViewMode(TIERS.TEAM);
    setSidebarSection('settings');
  };

  return (
    <ErrorBoundary name="SimpleHome">
      <div className="h-screen flex flex-col bg-background text-foreground">
        <SimpleHomeShell
          activeTab={activeSimpleTab}
          onTabChange={setActiveSimpleTab}
          onSwitchToPower={onSwitchToPower}
          onOpenSettings={onOpenSettings}
        >
          <Suspense fallback={null}>{variantFor(activeSimpleTab)}</Suspense>
        </SimpleHomeShell>
      </div>
    </ErrorBoundary>
  );
}
