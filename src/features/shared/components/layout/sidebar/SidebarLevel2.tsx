import { Key, Zap, Users, Sparkles } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { HomeTab, OverviewTab, TemplateTab, CloudTab, SettingsTab } from '@/lib/types/types';
import { useCredentialNav, type CredentialNavKey } from '@/features/vault/hooks/CredentialNavContext';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';
import GroupedAgentSidebar from '@/features/agents/components/GroupedAgentSidebar';
import TeamDragPanel from '@/features/pipeline/components/TeamDragPanel';
import SidebarSubNav from './SidebarSubNav';
import type { SubNavBadge } from './SidebarSubNav';
import {
  homeItems, overviewItems, credentialItems, templateItems,
  cloudItems, getSettingsItems,
} from './sidebarData';

interface SidebarLevel2Props {
  onCreatePersona: () => void;
}

export default function SidebarLevel2({ onCreatePersona }: SidebarLevel2Props) {
  const sidebarSection = usePersonaStore((s) => s.sidebarSection);
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
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const pendingEventCount = usePersonaStore((s) => s.pendingEventCount);
  const templateGalleryTotal = usePersonaStore((s) => s.templateGalleryTotal);
  const selectedTeamId = usePersonaStore((s) => s.selectedTeamId);
  const cloudTab = usePersonaStore((s) => s.cloudTab);
  const setCloudTab = usePersonaStore((s) => s.setCloudTab);
  const settingsTab = usePersonaStore((s) => s.settingsTab);
  const setSettingsTab = usePersonaStore((s) => s.setSettingsTab);

  const isDev = import.meta.env.DEV;

  const templateCount = connectorDefinitions.filter((conn) => {
    const metadata = conn.metadata as Record<string, unknown> | null;
    return metadata?.template_enabled === true;
  }).length;

  const dbCredCount = credentials.filter((c) => {
    const def = connectorDefinitions.find((d) => d.name === c.service_type);
    return def?.category === 'database';
  }).length;

  // Badge maps
  const overviewBadges: Record<string, SubNavBadge> = {};
  if (pendingReviewCount > 0) overviewBadges['manual-review'] = { count: pendingReviewCount, className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
  if (unreadMessageCount > 0) overviewBadges['messages'] = { count: unreadMessageCount, className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' };
  if (pendingEventCount > 0) overviewBadges['events'] = { count: pendingEventCount, className: 'bg-purple-500/20 text-purple-400 border border-purple-500/30' };

  const credentialBadges: Record<string, SubNavBadge> = {
    credentials: { count: credentials.length, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
    databases: { count: dbCredCount, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
    'from-template': { count: templateCount, className: 'bg-secondary/50 border border-primary/10 text-muted-foreground/90 font-normal' },
  };

  const settingsItems = getSettingsItems(isDev);

  switch (sidebarSection) {
    case 'home':
      return (
        <>
          <SidebarSubNav
            items={homeItems}
            activeId={homeTab}
            onSelect={(id) => setHomeTab(id as HomeTab)}
            variant="overview"
          />
          <div className="flex-1" />
          <div className="flex items-center justify-center py-6 opacity-[0.08] pointer-events-none select-none">
            <img
              src="/illustrations/logo-v1-geometric-nobg.png"
              alt=""
              className="w-24 h-24 object-contain"
            />
          </div>
        </>
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
      return <GroupedAgentSidebar onCreatePersona={onCreatePersona} />;

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
}
