import { silentCatch } from "@/lib/silentCatch";
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useScrollShadow } from '@/hooks/utility/interaction/useScrollShadow';
import { getVersion } from '@tauri-apps/api/app';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useBadgeCounts } from '@/hooks/sidebar/useBadgeCounts';
import type { SidebarSection } from '@/lib/types/types';
import OnboardingProgressBar from '@/features/onboarding/components/OnboardingProgressBar';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { sections } from './sidebarData';
import { SIDEBAR_TOGGLE_EVENT } from '@/features/shared/components/layout/DesktopFooter';
import SidebarLevel1 from './SidebarLevel1';
import SidebarLevel2 from './SidebarLevel2';

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (IS_MOBILE) return true;
    try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0'); } catch { /* intentional no-op */ }
      return next;
    });
  }, []);

  // Listen for toggle requests from the footer collapse button
  useEffect(() => {
    const handler = () => toggleCollapsed();
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, handler);
  }, [toggleCollapsed]);

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const { sidebarSection, settingsTab } = useSystemStore(
    useShallow((s) => ({ sidebarSection: s.sidebarSection, settingsTab: s.settingsTab }))
  );
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const { pendingReviewCount, unreadMessageCount, pendingEventCount } = useBadgeCounts();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const fetchBudgetSpend = useAgentStore((s) => s.fetchBudgetSpend);

  const isDev = import.meta.env.DEV;
  const [appVersion, setAppVersion] = useState('');

  // Persist scroll position per section
  const scrollPositions = useRef(new Map<string, number>());
  const level2ScrollRef = useRef<HTMLDivElement>(null);
  const prevSectionRef = useRef(sidebarSection);
  const { canScrollUp: l2ScrollUp, canScrollDown: l2ScrollDown } = useScrollShadow(level2ScrollRef);

  useEffect(() => {
    const el = level2ScrollRef.current;
    if (prevSectionRef.current !== sidebarSection) {
      if (el) scrollPositions.current.set(prevSectionRef.current, el.scrollTop);
      prevSectionRef.current = sidebarSection;
      requestAnimationFrame(() => {
        if (level2ScrollRef.current) {
          level2ScrollRef.current.scrollTop = scrollPositions.current.get(sidebarSection) ?? 0;
        }
      });
    }
  }, [sidebarSection]);

  const disabledSections = useMemo(() => {
    return new Set<SidebarSection>();
  }, []);

  const tier = useTier();


  // Redirect away from sections the current tier doesn't include
  useEffect(() => {
    const currentSection = sections.find((s) => s.id === sidebarSection);
    if (currentSection?.minTier && !tier.isVisible(currentSection.minTier)) {
      setSidebarSection('home');
    }
  }, [tier.current, sidebarSection, setSidebarSection]);

  useEffect(() => {
    if (isDev) return;
    if (settingsTab === 'engine' || settingsTab === 'byom') {
      setSettingsTab('account');
    }
  }, [isDev, settingsTab, setSettingsTab]);

  // App version — one-time fetch on mount
  useEffect(() => {
    getVersion().then(setAppVersion).catch(silentCatch("Sidebar:getVersion"));
  }, []);

  // Centralized 30s polling for budget data.
  // Badge counts (reviews, messages, events) are polled by useBadgeCounts.
  const pollingFetch = useCallback(() => {
    fetchBudgetSpend();
  }, [fetchBudgetSpend]);

  usePolling(pollingFetch, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    enabled: true,
    maxBackoff: POLLING_CONFIG.dashboardRefresh.maxBackoff,
  });

  const handleCreatePersona = useCallback(() => {
    // Reset build state so user gets a fresh creation form
    // (any in-progress build continues in the background)
    useAgentStore.getState().resetBuildSession();
    selectPersona(null);
    setIsCreatingPersona(true);
    setSidebarSection('personas');
  }, [selectPersona, setIsCreatingPersona, setSidebarSection]);

  // Expose total sidebar width as a CSS variable so fixed-position elements
  // (e.g. GuidedTour) can dock to the sidebar edge without hardcoded offsets.
  useEffect(() => {
    const width = IS_MOBILE ? 0 : collapsed ? 52 : 328; // Level1 + Level2
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }, [collapsed]);

  const handleMobileDrawerToggle = useCallback((section: SidebarSection) => {
    if (sidebarSection === section) {
      setMobileDrawerOpen((o) => !o);
    } else {
      setSidebarSection(section);
      setMobileDrawerOpen(true);
    }
  }, [sidebarSection, setSidebarSection]);

  return (
    <nav className="flex h-full" role="navigation" aria-label="Primary">
      <SidebarLevel1
        collapsed={collapsed}
        disabledSections={disabledSections}
        onMobileDrawerToggle={handleMobileDrawerToggle}
        appVersion={appVersion}
      />

      {/* Screen-reader announcements for badge count changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {pendingReviewCount > 0 && `${pendingReviewCount} pending review${pendingReviewCount !== 1 ? 's' : ''}.`}
        {unreadMessageCount > 0 && ` ${unreadMessageCount} unread message${unreadMessageCount !== 1 ? 's' : ''}.`}
        {pendingEventCount > 0 && ` ${pendingEventCount} pending event${pendingEventCount !== 1 ? 's' : ''}.`}
      </div>

      {/* Level 2: Item list */}
      {(IS_MOBILE ? mobileDrawerOpen : !collapsed) && (
        <>
          {IS_MOBILE && (
            <div
              className="fixed inset-0 bg-black/40 z-30"
              onClick={() => setMobileDrawerOpen(false)}
            />
          )}
          <div className={
            IS_MOBILE
              ? 'fixed left-[52px] top-0 bottom-0 z-40 w-[calc(100vw-64px)] max-w-[240px] bg-secondary/95 backdrop-blur-sm border-r border-primary/15 flex flex-col overflow-hidden shadow-elevation-4'
              : 'w-[240px] bg-secondary/30 border-r border-primary/15 flex flex-col overflow-hidden'
          }>
            <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
              <h2 className="typo-label text-muted-foreground/90">
                {sections.find((s) => s.id === sidebarSection)?.label || 'Overview'}
              </h2>
            </div>
            <div className="relative flex-1 min-h-0">
              <div ref={level2ScrollRef} className="h-full overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={sidebarSection}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    <SidebarLevel2 onCreatePersona={handleCreatePersona} />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div
                className={`absolute top-0 inset-x-0 h-6 pointer-events-none z-[1] transition-opacity duration-200 ${l2ScrollUp ? 'opacity-100' : 'opacity-0'}`}
                style={{ background: 'linear-gradient(to bottom, hsl(var(--secondary) / 0.3), transparent)' }}
              />
              <div
                className={`absolute bottom-0 inset-x-0 h-6 pointer-events-none z-[1] transition-opacity duration-200 ${l2ScrollDown ? 'opacity-100' : 'opacity-0'}`}
                style={{ background: 'linear-gradient(to top, hsl(var(--secondary) / 0.3), transparent)' }}
              />
            </div>
            {!IS_MOBILE && <OnboardingProgressBar />}
          </div>
        </>
      )}
    </nav>
  );
}
