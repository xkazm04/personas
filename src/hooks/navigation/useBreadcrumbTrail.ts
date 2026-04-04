import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useCredentialNav } from '@/features/vault/shared/hooks/CredentialNavContext';
import {
  sections,
  overviewItems,
  homeItems,
  credentialItems,
  eventBusItems,
  templateItems,
  devToolsItems,
} from '@/features/shared/components/layout/sidebar/sidebarData';
import { TAB_LABELS } from '@/features/agents/sub_editor/libs/editorTabConstants';


export interface BreadcrumbSegment {
  label: string;
  /** Callback to navigate to this level. Undefined for the current (last) segment. */
  onClick?: () => void;
}

/** Lazy-import the overview store only when the section is 'overview'. */
let cachedOverviewStore: typeof import('@/stores/overviewStore').useOverviewStore | null = null;
function getOverviewTab(): string {
  if (!cachedOverviewStore) {
    // Synchronous read -- the store module is already loaded by the time
    // the user navigates to overview.  If not yet loaded we return the default.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/stores/overviewStore');
      cachedOverviewStore = mod.useOverviewStore;
    } catch {
      return 'home';
    }
  }
  return cachedOverviewStore!.getState().overviewTab;
}

/**
 * Computes a breadcrumb trail from the current navigation state.
 * Each segment is a { label, onClick? } pair.
 * The final segment represents the current view and has no onClick.
 */
export function useBreadcrumbTrail(): BreadcrumbSegment[] {
  const {
    sidebarSection,
    homeTab,
    editorTab,
    agentTab,
    cloudTab,
    settingsTab,
    templateTab,
    pluginTab,
    devToolsTab,
    eventBusTab,
    isCreatingPersona,
  } = useSystemStore(
    useShallow((s) => ({
      sidebarSection: s.sidebarSection,
      homeTab: s.homeTab,
      editorTab: s.editorTab,
      agentTab: s.agentTab,
      cloudTab: s.cloudTab,
      settingsTab: s.settingsTab,
      templateTab: s.templateTab,
      pluginTab: s.pluginTab,
      devToolsTab: s.devToolsTab,
      eventBusTab: s.eventBusTab,
      isCreatingPersona: s.isCreatingPersona,
    })),
  );

  const { selectedPersonaId, selectedPersona } = useAgentStore(
    useShallow((s) => ({
      selectedPersonaId: s.selectedPersonaId,
      selectedPersona: s.selectedPersona,
    })),
  );

  const credentialNav = useCredentialNav();

  return useMemo(() => {
    const trail: BreadcrumbSegment[] = [];
    const setSidebarSection = useSystemStore.getState().setSidebarSection;

    // --- Level 1: Section ---
    const sectionDef = sections.find((s) => s.id === sidebarSection);
    const sectionLabel = sectionDef?.label ?? sidebarSection;

    // Helper: find label from a sub-nav items array
    const findSubLabel = (items: { id: string; label: string }[], id: string) =>
      items.find((i) => i.id === id)?.label ?? id;

    // Resolve section-specific sub-tabs
    switch (sidebarSection) {
      case 'home': {
        const tabLabel = findSubLabel(homeItems, homeTab);
        trail.push({ label: sectionLabel, onClick: () => setSidebarSection('home') });
        trail.push({ label: tabLabel });
        break;
      }

      case 'overview': {
        const overviewTab = getOverviewTab();
        const tabLabel = findSubLabel(overviewItems, overviewTab);
        if (overviewTab === 'home') {
          // Dashboard is the root — single segment
          trail.push({ label: sectionLabel });
        } else {
          trail.push({ label: sectionLabel, onClick: () => {
            setSidebarSection('overview');
            cachedOverviewStore?.getState().setOverviewTab('home');
          }});
          trail.push({ label: tabLabel });
        }
        break;
      }

      case 'personas': {
        if (agentTab === 'cloud') {
          trail.push({ label: sectionLabel, onClick: () => useSystemStore.getState().setAgentTab('all') });
          trail.push({ label: 'Cloud' });
        } else if (agentTab === 'team') {
          trail.push({ label: sectionLabel, onClick: () => useSystemStore.getState().setAgentTab('all') });
          trail.push({ label: 'Teams' });
        } else if (isCreatingPersona) {
          trail.push({ label: sectionLabel, onClick: () => {
            setSidebarSection('personas');
            useSystemStore.getState().setIsCreatingPersona(false);
          }});
          trail.push({ label: 'New Agent' });
        } else if (selectedPersonaId && selectedPersona) {
          const personaName = selectedPersona.name || 'Agent';
          const editorLabel = TAB_LABELS[editorTab] ?? editorTab;
          trail.push({ label: sectionLabel, onClick: () => {
            useAgentStore.getState().selectPersona(null);
          }});
          trail.push({
            label: personaName,
            onClick: () => useSystemStore.getState().setEditorTab('use-cases'),
          });
          trail.push({ label: editorLabel });
        } else {
          trail.push({ label: sectionLabel });
        }
        break;
      }

      case 'credentials': {
        const credKey = credentialNav.currentKey;
        const tabLabel = findSubLabel(credentialItems, credKey);
        if (credKey === 'credentials') {
          trail.push({ label: sectionLabel });
        } else {
          trail.push({ label: sectionLabel, onClick: () => credentialNav.navigate('credentials') });
          trail.push({ label: tabLabel });
        }
        break;
      }

      case 'events': {
        const tabLabel = findSubLabel(eventBusItems, eventBusTab);
        trail.push({ label: sectionLabel, onClick: () => setSidebarSection('events') });
        trail.push({ label: tabLabel });
        break;
      }

      case 'design-reviews': {
        const tabLabel = findSubLabel(templateItems, templateTab);
        trail.push({ label: sectionLabel, onClick: () => setSidebarSection('design-reviews') });
        trail.push({ label: tabLabel });
        break;
      }

      case 'settings': {
        const tabLabel = settingsTab.charAt(0).toUpperCase() + settingsTab.slice(1);
        trail.push({ label: sectionLabel, onClick: () => setSidebarSection('settings') });
        trail.push({ label: tabLabel });
        break;
      }

      case 'plugins': {
        if (pluginTab === 'dev-tools') {
          const tabLabel = findSubLabel(devToolsItems, devToolsTab);
          trail.push({ label: sectionLabel, onClick: () => useSystemStore.getState().setPluginTab('browse') });
          trail.push({ label: 'Dev Tools', onClick: () => setSidebarSection('plugins') });
          trail.push({ label: tabLabel });
        } else if (pluginTab === 'doc-signing') {
          trail.push({ label: sectionLabel, onClick: () => useSystemStore.getState().setPluginTab('browse') });
          trail.push({ label: 'Doc Signing' });
        } else if (pluginTab === 'ocr') {
          trail.push({ label: sectionLabel, onClick: () => useSystemStore.getState().setPluginTab('browse') });
          trail.push({ label: 'OCR' });
        } else if (pluginTab === 'obsidian-brain') {
          trail.push({ label: sectionLabel, onClick: () => useSystemStore.getState().setPluginTab('browse') });
          trail.push({ label: 'Obsidian Brain' });
        } else {
          trail.push({ label: sectionLabel });
        }
        break;
      }

      default: {
        trail.push({ label: sectionLabel });
        break;
      }
    }

    return trail;
  }, [
    sidebarSection, homeTab, editorTab, agentTab, cloudTab, settingsTab,
    templateTab, pluginTab, devToolsTab, eventBusTab, isCreatingPersona,
    selectedPersonaId, selectedPersona, credentialNav.currentKey,
  ]);
}
