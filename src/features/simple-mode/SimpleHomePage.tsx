import { lazy, Suspense, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSystemStore } from '@/stores/systemStore';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import type { SimpleTab } from '@/stores/slices/system/simpleModeSlice';

import { SimpleHomeShell } from './components/SimpleHomeShell';
import { CATEGORIES } from './hooks/useIllustration';

// Variants are lazy-loaded so switching tabs only fetches the chunk you need.
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
 * Cockpit page — embedded as a Home sub-tab. Renders a 3-tab switcher
 * (Mosaic / Console / Inbox) inside the Home layout. The settings gear
 * navigates the sidebar to the Settings section.
 */
export default function SimpleHomePage() {
  const { activeSimpleTab, setActiveSimpleTab, setSidebarSection } = useSystemStore(
    useShallow((s) => ({
      activeSimpleTab: s.activeSimpleTab,
      setActiveSimpleTab: s.setActiveSimpleTab,
      setSidebarSection: s.setSidebarSection,
    })),
  );

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

  const onOpenSettings = useCallback(() => {
    setSidebarSection('settings');
  }, [setSidebarSection]);

  return (
    <ErrorBoundary name="Cockpit">
      <div className="flex-1 min-h-0 flex flex-col bg-background text-foreground simple-min-width">
        <SimpleHomeShell
          activeTab={activeSimpleTab}
          onTabChange={setActiveSimpleTab}
          onOpenSettings={onOpenSettings}
        >
          <Suspense fallback={null}>{variantFor(activeSimpleTab)}</Suspense>
        </SimpleHomeShell>
      </div>
    </ErrorBoundary>
  );
}
