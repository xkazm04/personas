import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { BarChart3, Bot, Zap, Key, Activity, ClipboardCheck, MessageSquare, FlaskConical, Eye, Users, Radio, Brain, DollarSign, Cloud, Plus, LayoutTemplate, Monitor, Blocks, Upload, List, Settings, Chrome, Palette, Bell, GitBranch } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { usePersonaStore } from '@/stores/personaStore';
import type { SidebarSection, OverviewTab, TemplateTab, SettingsTab } from '@/lib/types/types';
import GroupedAgentSidebar from '@/features/agents/components/GroupedAgentSidebar';

const disabledSections = new Set<SidebarSection>(['team', 'cloud']);

const sections: Array<{ id: SidebarSection; icon: typeof Bot; label: string }> = [
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'personas', icon: Bot, label: 'Agents' },
  { id: 'events', icon: Zap, label: 'Events' },
  { id: 'credentials', icon: Key, label: 'Keys' },
  { id: 'design-reviews', icon: FlaskConical, label: 'Templates' },
  { id: 'team', icon: Users, label: 'Teams' },
  { id: 'cloud', icon: Cloud, label: 'Cloud' },
  { id: 'gitlab', icon: GitBranch, label: 'GitLab' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const sidebarSection = usePersonaStore((s) => s.sidebarSection);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const credentialView = usePersonaStore((s) => s.credentialView);
  const setCredentialView = usePersonaStore((s) => s.setCredentialView);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
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
  const settingsTab = usePersonaStore((s) => s.settingsTab);
  const setSettingsTab = usePersonaStore((s) => s.setSettingsTab);

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

  const overviewItems: Array<{ id: OverviewTab; icon: typeof Activity; label: string }> = [
    { id: 'system-check', icon: Monitor, label: 'System Check' },
    { id: 'executions', icon: Activity, label: 'Executions' },
    { id: 'manual-review', icon: ClipboardCheck, label: 'Manual Review' },
    { id: 'messages', icon: MessageSquare, label: 'Messages' },
    { id: 'events', icon: Zap, label: 'Events' },
    { id: 'usage', icon: BarChart3, label: 'Usage' },
    { id: 'observability', icon: Eye, label: 'Observability' },
    { id: 'realtime', icon: Radio, label: 'Realtime' },
    { id: 'memories', icon: Brain, label: 'Memories' },
    { id: 'budget', icon: DollarSign, label: 'Budget' },
  ];

  const renderLevel2 = () => {
    if (sidebarSection === 'overview') {
      return (
        <>
          {overviewItems.map((item) => {
            const Icon = item.icon;
            const isActive = overviewTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setOverviewTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 mb-1 rounded-xl transition-all ${
                  isActive
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/50 border border-transparent'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${
                  isActive
                    ? 'bg-primary/15 border-primary/25'
                    : 'bg-secondary/40 border-primary/15'
                }`}>
                  <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground/90'}`} />
                </div>
                <span className={`text-sm font-medium ${isActive ? 'text-foreground/90' : 'text-muted-foreground/80'}`}>
                  {item.label}
                </span>
                {item.id === 'manual-review' && pendingReviewCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 text-sm font-bold leading-none rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    {pendingReviewCount}
                  </span>
                )}
                {item.id === 'messages' && unreadMessageCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 text-sm font-bold leading-none rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    {unreadMessageCount}
                  </span>
                )}
                {item.id === 'events' && pendingEventCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 text-sm font-bold leading-none rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    {pendingEventCount}
                  </span>
                )}
              </button>
            );
          })}
        </>
      );
    }

    if (sidebarSection === 'personas') {
      return <GroupedAgentSidebar onCreatePersona={handleCreatePersona} />;
    }

    if (sidebarSection === 'events') {
      return (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap className="w-6 h-6 text-amber-400/60" />
          </div>
          <p className="text-sm text-muted-foreground/80">Event triggers</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Configure in persona settings</p>
        </div>
      );
    }

    if (sidebarSection === 'credentials') {
      const items = [
        { id: 'credentials', label: 'Credentials', icon: Key },
        { id: 'from-template', label: 'Add from template', icon: LayoutTemplate },
        { id: 'add-new', label: 'Add new', icon: Plus },
      ] as const;

      return (
        <>
          {items.map((item) => {
            const active = credentialView === item.id;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSidebarSection('credentials');
                  setCredentialView(item.id);
                }}
                className={`w-full mb-1 p-2.5 rounded-xl border transition-all text-left ${
                  active
                    ? 'bg-primary/10 border-primary/20'
                    : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${
                    active
                      ? 'bg-primary/15 border-primary/25'
                      : 'bg-secondary/40 border-primary/15'
                  }`}>
                    <ItemIcon className={`w-3.5 h-3.5 ${active ? 'text-primary' : 'text-muted-foreground/80'}`} />
                  </div>
                  <span className={`text-sm ${active ? 'text-foreground/90' : 'text-muted-foreground/65'}`}>
                    {item.label}
                  </span>
                  {item.id === 'credentials' && (
                    <span className="ml-auto text-sm px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-muted-foreground/90">
                      {credentials.length}
                    </span>
                  )}
                  {item.id === 'from-template' && (
                    <span className="ml-auto text-sm px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-muted-foreground/90">
                      {templateCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {credentials.length === 0 && credentialView === 'credentials' && (
            <div className="text-center py-8">
              <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Key className="w-5 h-5 text-emerald-400/60" />
              </div>
              <p className="text-sm text-muted-foreground/80">No credentials yet</p>
            </div>
          )}
        </>
      );
    }

    if (sidebarSection === 'design-reviews') {
      const templateItems: Array<{ id: TemplateTab; label: string; icon: typeof Blocks }> = [
        { id: 'builtin', label: 'Built-in Templates', icon: Blocks },
        { id: 'n8n', label: 'n8n Import', icon: Upload },
        { id: 'generated', label: 'Generated', icon: List },
      ];

      return (
        <>
          {templateItems.map((item) => {
            const active = templateTab === item.id;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSidebarSection('design-reviews');
                  setTemplateTab(item.id);
                }}
                className={`w-full mb-1 p-2.5 rounded-xl border transition-all text-left ${
                  active
                    ? 'bg-primary/10 border-primary/20'
                    : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${
                    active
                      ? 'bg-primary/15 border-primary/25'
                      : 'bg-secondary/40 border-primary/15'
                  }`}>
                    <ItemIcon className={`w-3.5 h-3.5 ${active ? 'text-primary' : 'text-muted-foreground/80'}`} />
                  </div>
                  <span className={`text-sm ${active ? 'text-foreground/90' : 'text-muted-foreground/65'}`}>
                    {item.label}
                  </span>
                </div>
              </button>
            );
          })}
        </>
      );
    }

    if (sidebarSection === 'team') {
      return (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-indigo-400/60" />
          </div>
          <p className="text-sm text-muted-foreground/80">Multi-Agent Teams</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Design agent pipelines visually</p>
        </div>
      );
    }

    if (sidebarSection === 'cloud') {
      return (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Cloud className="w-6 h-6 text-indigo-400/60" />
          </div>
          <p className="text-sm text-muted-foreground/80">Cloud Execution</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Run agents on remote workers</p>
        </div>
      );
    }

    if (sidebarSection === 'gitlab') {
      return (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
            <GitBranch className="w-6 h-6 text-orange-400/60" />
          </div>
          <p className="text-sm text-muted-foreground/80">GitLab Integration</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Deploy personas as Duo Agents</p>
        </div>
      );
    }

    if (sidebarSection === 'settings') {
      const settingsItems: Array<{ id: SettingsTab; label: string; icon: typeof Chrome }> = [
        { id: 'account', label: 'Account', icon: Chrome },
        { id: 'appearance', label: 'Appearance', icon: Palette },
        { id: 'notifications', label: 'Notifications', icon: Bell },
      ];

      return (
        <>
          {settingsItems.map((item) => {
            const active = settingsTab === item.id;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setSettingsTab(item.id)}
                className={`w-full mb-1 p-2.5 rounded-xl border transition-all text-left ${
                  active
                    ? 'bg-primary/10 border-primary/20'
                    : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${
                    active
                      ? 'bg-primary/15 border-primary/25'
                      : 'bg-secondary/40 border-primary/15'
                  }`}>
                    <ItemIcon className={`w-3.5 h-3.5 ${active ? 'text-primary' : 'text-muted-foreground/80'}`} />
                  </div>
                  <span className={`text-sm ${active ? 'text-foreground/90' : 'text-muted-foreground/65'}`}>
                    {item.label}
                  </span>
                </div>
              </button>
            );
          })}
        </>
      );
    }

    return null;
  };

  return (
    <div className="flex h-full">

      {/* Level 1: Section icons */}
      <div className="w-[60px] bg-secondary/40 border-r border-primary/15 flex flex-col items-center py-4 gap-1.5">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = sidebarSection === section.id;
          const isDisabled = disabledSections.has(section.id);

          return (
            <button
              key={section.id}
              onClick={() => !isDisabled && setSidebarSection(section.id)}
              disabled={isDisabled}
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all group ${
                isDisabled ? 'cursor-not-allowed opacity-40' : ''
              }`}
              title={isDisabled ? `${section.label} (Coming soon)` : section.label}
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
              {isDisabled && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 z-20 px-1 py-px text-[7px] font-semibold uppercase tracking-wider leading-none rounded bg-muted-foreground/15 text-muted-foreground/80 whitespace-nowrap">
                  soon
                </span>
              )}
              {section.id === 'overview' && pendingReviewCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 z-20 min-w-[16px] h-4 px-1 flex items-center justify-center text-sm font-bold leading-none rounded-full bg-amber-500 text-white shadow-sm shadow-amber-500/30">
                  {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                </span>
              )}
              {section.id === 'design-reviews' && n8nTransformActive && (
                <span className="absolute -top-0.5 -right-0.5 z-20 w-4 h-4 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-amber-500/40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-600/50" />
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

      {/* Level 2: Item list */}
      <div className="w-[240px] bg-secondary/30 border-r border-primary/15 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
          <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
            {sections.find((s) => s.id === sidebarSection)?.label || 'Overview'}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {renderLevel2()}
        </div>
      </div>
    </div>
  );
}
