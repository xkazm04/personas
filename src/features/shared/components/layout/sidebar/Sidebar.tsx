import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import type { SidebarSection } from '@/lib/types/types';
import OnboardingProgressBar from '@/features/onboarding/components/OnboardingProgressBar';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { sections } from './sidebarData';
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

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const sidebarSection = usePersonaStore((s) => s.sidebarSection);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const pendingReviewCount = usePersonaStore((s) => s.pendingReviewCount);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const pendingEventCount = usePersonaStore((s) => s.pendingEventCount);
  const fetchRecentEvents = usePersonaStore((s) => s.fetchRecentEvents);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setIsCreatingPersona = usePersonaStore((s) => s.setIsCreatingPersona);
  const settingsTab = usePersonaStore((s) => s.settingsTab);
  const setSettingsTab = usePersonaStore((s) => s.setSettingsTab);
  const fetchBudgetSpend = usePersonaStore((s) => s.fetchBudgetSpend);

  const isDev = import.meta.env.DEV;
  const [appVersion, setAppVersion] = useState('');

  // Persist scroll position per section
  const scrollPositions = useRef(new Map<string, number>());
  const level2ScrollRef = useRef<HTMLDivElement>(null);
  const prevSectionRef = useRef(sidebarSection);

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

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const disabledSections = useMemo(() => {
    const disabled = new Set<SidebarSection>();
    if (!isAuthenticated) disabled.add('cloud');
    return disabled;
  }, [isAuthenticated]);

  // Redirect away from dev-only sections/tabs when not in dev mode
  useEffect(() => {
    if (isDev) return;
    if (sidebarSection === 'team' || sidebarSection === 'cloud') {
      setSidebarSection('home');
    }
  }, [isDev, sidebarSection, setSidebarSection]);

  useEffect(() => {
    if (isDev) return;
    if (settingsTab === 'engine' || settingsTab === 'byom') {
      setSettingsTab('account');
    }
  }, [isDev, settingsTab, setSettingsTab]);

  useEffect(() => {
    fetchPendingReviewCount();
    fetchUnreadMessageCount();
    fetchRecentEvents();
    fetchBudgetSpend();
    getVersion().then(setAppVersion).catch(() => {});

    const interval = setInterval(() => {
      fetchPendingReviewCount();
      fetchBudgetSpend();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchPendingReviewCount, fetchUnreadMessageCount, fetchRecentEvents, fetchBudgetSpend]);

  const handleCreatePersona = useCallback(() => {
    selectPersona(null);
    setIsCreatingPersona(true);
    setSidebarSection('personas');
  }, [selectPersona, setIsCreatingPersona, setSidebarSection]);

  const handleMobileDrawerToggle = useCallback((section: SidebarSection) => {
    if (sidebarSection === section) {
      setMobileDrawerOpen((o) => !o);
    } else {
      setSidebarSection(section);
      setMobileDrawerOpen(true);
    }
  }, [sidebarSection, setSidebarSection]);

  return (
    <div className="flex h-full">
      <SidebarLevel1
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
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
              ? 'fixed left-[52px] top-0 bottom-0 z-40 w-[calc(100vw-64px)] max-w-[240px] bg-secondary/95 backdrop-blur-sm border-r border-primary/15 flex flex-col overflow-hidden shadow-2xl'
              : 'w-[240px] bg-secondary/30 border-r border-primary/15 flex flex-col overflow-hidden'
          }>
            <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
              <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                {sections.find((s) => s.id === sidebarSection)?.label || 'Overview'}
              </h2>
            </div>
            <div ref={level2ScrollRef} className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent">
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
            {!IS_MOBILE && <OnboardingProgressBar />}
          </div>
        </>
      )}
    </div>
  );
}
