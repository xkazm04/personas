import { motion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Bot, Zap, Key, Activity, ClipboardCheck, MessageSquare, FlaskConical, Users, Brain, Cloud, Plus, LayoutTemplate, Monitor, Upload, List, Settings, Chrome, Palette, Bell, GitBranch, LayoutDashboard, Cpu, Network, Database, Home, Compass, Sparkles, HardDriveDownload, Shield, type LucideIcon } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import type { SidebarSection, HomeTab, OverviewTab, TemplateTab, CloudTab, SettingsTab } from '@/lib/types/types';
import GroupedAgentSidebar from '@/features/agents/components/GroupedAgentSidebar';
import TeamDragPanel from '@/features/pipeline/components/TeamDragPanel';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/hooks/CredentialNavContext';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';
import OnboardingProgressBar from '@/features/onboarding/components/OnboardingProgressBar';

const sections: Array<{ id: SidebarSection; icon: typeof Bot; label: string; devOnly?: boolean }> = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'personas', icon: Bot, label: 'Agents' },
  { id: 'events', icon: Zap, label: 'Events' },
  { id: 'credentials', icon: Key, label: 'Keys' },
  { id: 'design-reviews', icon: FlaskConical, label: 'Templates' },
  { id: 'team', icon: Users, label: 'Teams', devOnly: true },
  { id: 'cloud', icon: Cloud, label: 'Cloud', devOnly: true },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

// ---------------------------------------------------------------------------
// SidebarSubNav — data-driven sub-navigation
// ---------------------------------------------------------------------------

interface SubNavItem {
  id: string;
  icon: LucideIcon;
  label: string;
  devOnly?: boolean;
}

interface SubNavBadge {
  count: number;
  /** Tailwind classes for the badge pill (bg, text, border) */
  className: string;
}

function SidebarSubNav({
  items,
  activeId,
  onSelect,
  badges = {},
  variant = 'compact',
  devItems,
  children,
}: {
  items: SubNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  badges?: Record<string, SubNavBadge>;
  variant?: 'overview' | 'compact';
  devItems?: Set<string>;
  children?: ReactNode;
}) {
  const isOverview = variant === 'overview';
  const boxSize = isOverview ? 'w-8 h-8' : 'w-7 h-7';
  const iconSize = isOverview ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeId === item.id;
        const badge = badges[item.id];
        const isDevItem = devItems?.has(item.id);

        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center ${isOverview ? 'gap-3 px-3 py-2.5' : 'gap-2.5 p-2.5'} mb-1 rounded-xl border transition-all text-left ${
              isActive
                ? isDevItem
                  ? 'bg-amber-500/8 border-amber-500/35'
                  : 'bg-primary/10 border-primary/20'
                : isDevItem
                  ? 'bg-amber-500/5 border-amber-500/25 hover:bg-amber-500/10'
                  : isOverview
                    ? 'hover:bg-secondary/50 border-transparent'
                    : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
            }`}
          >
            <div className={`${boxSize} rounded-lg flex items-center justify-center border transition-colors ${
              isActive
                ? 'bg-primary/15 border-primary/25'
                : 'bg-secondary/40 border-primary/15'
            }`}>
              <Icon className={`${iconSize} ${isActive ? 'text-primary' : 'text-muted-foreground/90'}`} />
            </div>
            <span className={`text-sm ${isActive ? 'font-medium text-foreground/90' : isOverview ? 'font-medium text-muted-foreground/80' : 'text-muted-foreground/65'}`}>
              {item.label}
            </span>
            {badge && badge.count > 0 && (
              <span className={`ml-auto px-1.5 py-0.5 text-sm font-bold leading-none rounded-full ${badge.className}`}>
                {badge.count}
              </span>
            )}
          </button>
        );
      })}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export default function Sidebar() {
  const sidebarSection = usePersonaStore((s) => s.sidebarSection);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const { currentKey: credentialView, navigate } = useCredentialNav();
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const homeTab = usePersonaStore((s) => s.homeTab);
  const setHomeTab = usePersonaStore((s) => s.setHomeTab);
  const overviewTab = usePersonaStore((s) => s.overviewTab);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);
  const templateTab = usePersonaStore((s) => s.templateTab);
  const setTemplateTab = usePersonaStore((s) => s.setTemplateTab);
  const pendingReviewCount = usePersonaStore((s) => s.pendingReviewCount);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const pendingEventCount = usePersonaStore((s) => s.pendingEventCount);
  const fetchRecentEvents = usePersonaStore((s) => s.fetchRecentEvents);
  const n8nTransformActive = usePersonaStore((s) => s.n8nTransformActive);
  const templateAdoptActive = usePersonaStore((s) => s.templateAdoptActive);
  const rebuildActive = usePersonaStore((s) => s.rebuildActive);
  const templateTestActive = usePersonaStore((s) => s.templateTestActive);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const connectorTestActive = usePersonaStore((s) => s.connectorTestActive);
  const templateGalleryTotal = usePersonaStore((s) => s.templateGalleryTotal);
  const selectedTeamId = usePersonaStore((s) => s.selectedTeamId);
  const cloudTab = usePersonaStore((s) => s.cloudTab);
  const setCloudTab = usePersonaStore((s) => s.setCloudTab);
  const settingsTab = usePersonaStore((s) => s.settingsTab);
  const setSettingsTab = usePersonaStore((s) => s.setSettingsTab);

  const isDev = import.meta.env.DEV;

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

  const templateCount = connectorDefinitions.filter((conn) => {
    const metadata = conn.metadata as Record<string, unknown> | null;
    return metadata?.template_enabled === true;
  }).length;

  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setIsCreatingPersona = usePersonaStore((s) => s.setIsCreatingPersona);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    fetchPendingReviewCount();
    fetchUnreadMessageCount();
    fetchRecentEvents();
    getVersion().then(setAppVersion).catch(() => {});

    // Poll for pending reviews periodically so users discover them promptly
    const interval = setInterval(() => {
      fetchPendingReviewCount();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchPendingReviewCount, fetchUnreadMessageCount, fetchRecentEvents]);

  const handleCreatePersona = () => {
    selectPersona(null);
    setIsCreatingPersona(true);
    setSidebarSection('personas');
  };

  const homeItems: Array<{ id: HomeTab; icon: typeof Activity; label: string }> = [
    { id: 'welcome', icon: Compass, label: 'Welcome' },
    { id: 'system-check', icon: Monitor, label: 'System Check' },
  ];

  const overviewItems: Array<{ id: OverviewTab; icon: typeof Activity; label: string }> = [
    { id: 'home', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'executions', icon: Activity, label: 'Executions' },
    { id: 'manual-review', icon: ClipboardCheck, label: 'Manual Review' },
    { id: 'messages', icon: MessageSquare, label: 'Messages' },
    { id: 'events', icon: Zap, label: 'Events' },
    { id: 'knowledge', icon: Brain, label: 'Knowledge' },
    { id: 'sla', icon: Shield, label: 'SLA' },
    { id: 'cron-agents', icon: Cpu, label: 'Cron Agents' },
  ];

  // Badge maps (only computed for sections that use them)
  const overviewBadges: Record<string, SubNavBadge> = {};
  if (pendingReviewCount > 0) overviewBadges['manual-review'] = { count: pendingReviewCount, className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
  if (unreadMessageCount > 0) overviewBadges['messages'] = { count: unreadMessageCount, className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' };
  if (pendingEventCount > 0) overviewBadges['events'] = { count: pendingEventCount, className: 'bg-purple-500/20 text-purple-400 border border-purple-500/30' };

  const dbCredCount = credentials.filter((c) => {
    const def = connectorDefinitions.find((d) => d.name === c.service_type);
    return def?.category === 'database';
  }).length;

  const credentialBadges: Record<string, SubNavBadge> = {
    credentials: { count: credentials.length, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
    databases: { count: dbCredCount, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
    'from-template': { count: templateCount, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
  };

  const credentialItems: SubNavItem[] = [
    { id: 'credentials', label: 'Credentials', icon: Key },
    { id: 'databases', label: 'Databases', icon: Database },
    { id: 'from-template', label: 'Catalog', icon: LayoutTemplate },
    { id: 'add-new', label: 'Add new', icon: Plus },
  ];

  const templateItems: SubNavItem[] = [
    { id: 'n8n', label: 'n8n Import', icon: Upload },
    { id: 'generated', label: 'Generated', icon: List },
  ];

  const cloudItems: SubNavItem[] = [
    { id: 'unified', label: 'All Deployments', icon: LayoutDashboard },
    { id: 'cloud', label: 'Cloud Execution', icon: Cloud },
    { id: 'gitlab', label: 'GitLab', icon: GitBranch },
  ];

  const settingsItems: SubNavItem[] = [
    { id: 'account', label: 'Account', icon: Chrome },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'engine', label: 'Engine', icon: Cpu, devOnly: true },
    { id: 'byom', label: 'BYOM', icon: Network, devOnly: true },
    { id: 'portability', label: 'Data', icon: HardDriveDownload },
    { id: 'admin', label: 'Admin', icon: Shield, devOnly: true },
  ].filter((item) => !item.devOnly || isDev);

  const renderLevel2 = () => {
    switch (sidebarSection) {
      case 'home':
        return (
          <SidebarSubNav
            items={homeItems}
            activeId={homeTab}
            onSelect={(id) => setHomeTab(id as HomeTab)}
            variant="overview"
          />
        );

      case 'overview':
        return (
          <SidebarSubNav
            items={overviewItems}
            activeId={overviewTab}
            onSelect={(id) => setOverviewTab(id as OverviewTab)}
            badges={overviewBadges}
            variant="overview"
          />
        );

      case 'personas':
        return <GroupedAgentSidebar onCreatePersona={handleCreatePersona} />;

      case 'events':
        return (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-amber-400/60" />
            </div>
            <p className="text-sm text-muted-foreground/80">Event triggers</p>
            <p className="text-sm text-muted-foreground/80 mt-1">Configure in persona settings</p>
          </div>
        );

      case 'credentials':
        return (
          <SidebarSubNav
            items={credentialItems}
            activeId={credentialView}
            onSelect={(id) => navigate(id as CredentialNavKey)}
            badges={credentialBadges}
          >
            {credentials.length === 0 && credentialView === 'credentials' && (
              <div className="text-center py-8 space-y-3">
                <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Key className="w-5 h-5 text-emerald-400/60" />
                </div>
                <p className="text-sm text-muted-foreground/80">No credentials yet</p>
                <button
                  onClick={() => useProvisioningWizardStore.getState().open(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-violet-500/25 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  AI Setup Wizard
                </button>
              </div>
            )}
          </SidebarSubNav>
        );

      case 'design-reviews':
        return (
          <SidebarSubNav
            items={templateItems}
            activeId={templateTab}
            onSelect={(id) => setTemplateTab(id as TemplateTab)}
            badges={templateGalleryTotal > 0 ? {
              generated: { count: templateGalleryTotal, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
            } : undefined}
          />
        );

      case 'team':
        if (selectedTeamId) {
          return <TeamDragPanel />;
        }
        return (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-indigo-400/60" />
            </div>
            <p className="text-sm text-muted-foreground/80">Multi-Agent Teams</p>
            <p className="text-sm text-muted-foreground/80 mt-1">Select a team to begin</p>
          </div>
        );

      case 'cloud':
        return (
          <SidebarSubNav
            items={cloudItems}
            activeId={cloudTab}
            onSelect={(id) => setCloudTab(id as CloudTab)}
          />
        );

      case 'settings':
        return (
          <SidebarSubNav
            items={settingsItems}
            activeId={settingsTab}
            onSelect={(id) => setSettingsTab(id as SettingsTab)}
            devItems={isDev ? new Set(['engine', 'byom']) : undefined}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-full">

      {/* Level 1: Section icons */}
      <div className="w-[60px] bg-secondary/40 border-r border-primary/15 flex flex-col items-center py-4 gap-1.5">
        {sections
          .filter((s) => !s.devOnly || isDev)
          .map((section) => {
          const Icon = section.icon;
          const isActive = sidebarSection === section.id;
          const isDisabled = disabledSections.has(section.id);
          const isDevSection = section.devOnly;

          return (
            <button
              key={section.id}
              onClick={() => !isDisabled && setSidebarSection(section.id)}
              disabled={isDisabled}
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all group ${
                isDisabled ? 'cursor-not-allowed opacity-40' : ''
              } ${isDevSection ? 'ring-1 ring-amber-500/40' : ''}`}
              title={isDisabled ? `${section.label} (${section.id === 'cloud' ? 'Sign in to unlock cloud features' : 'Coming soon'})` : section.label}
            >
              {isActive && !isDisabled && (
                <motion.div
                  layoutId="sidebarSectionIndicator"
                  className="absolute inset-0 rounded-xl bg-primary/15 border border-primary/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <Icon className={`relative z-10 w-5 h-5 transition-colors ${
                isDisabled
                  ? 'text-muted-foreground/80'
                  : isActive ? 'text-primary' : 'text-muted-foreground/90 group-hover:text-foreground/95'
              }`} />
              {isDisabled && section.id !== 'cloud' && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 z-20 px-1 py-px text-sm font-semibold uppercase tracking-wider leading-none rounded bg-muted-foreground/15 text-muted-foreground/80 whitespace-nowrap">
                  soon
                </span>
              )}
              {section.id === 'overview' && pendingReviewCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 z-20 min-w-[16px] h-4 px-1 flex items-center justify-center text-sm font-bold leading-none rounded-full bg-amber-500 text-white shadow-sm shadow-amber-500/30">
                  {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                </span>
              )}
              {section.id === 'design-reviews' && (n8nTransformActive || templateAdoptActive || rebuildActive || templateTestActive) && (
                <span className="absolute -top-0.5 -right-0.5 z-20 w-4 h-4 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-amber-500/40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-600/50" />
                </span>
              )}
              {section.id === 'personas' && (isLabRunning || connectorTestActive) && (
                <span className="absolute -top-0.5 -right-0.5 z-20 w-4 h-4 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-cyan-500/40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-cyan-500 border border-cyan-600/50" />
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />
        {appVersion && (
          <div className="pb-2 pt-1">
            <span className="text-sm font-mono text-muted-foreground/80 block text-center">
              v{appVersion}
            </span>
          </div>
        )}
      </div>

      {/* Screen-reader announcements for badge count changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {pendingReviewCount > 0 && `${pendingReviewCount} pending review${pendingReviewCount !== 1 ? 's' : ''}.`}
        {unreadMessageCount > 0 && ` ${unreadMessageCount} unread message${unreadMessageCount !== 1 ? 's' : ''}.`}
        {pendingEventCount > 0 && ` ${pendingEventCount} pending event${pendingEventCount !== 1 ? 's' : ''}.`}
      </div>

      {/* Level 2: Item list */}
      <div className="w-[240px] bg-secondary/30 border-r border-primary/15 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
          <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
            {sections.find((s) => s.id === sidebarSection)?.label || 'Overview'}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent">
          {renderLevel2()}
        </div>
        <OnboardingProgressBar />
      </div>
    </div>
  );
}
