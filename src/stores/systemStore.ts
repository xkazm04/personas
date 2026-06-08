/**
 * System domain store -- UI chrome, cloud, GitLab, onboarding, guided tour,
 * dev-tools, network / P2P, and setup wizard.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SystemStore } from "./storeTypes";
import { createDedupedJSONStorage } from "./util/dedupedStorage";

import { createUiSlice } from "./slices/system/uiSlice";
import { createCloudSlice } from "./slices/system/cloudSlice";
import { createGitLabSlice } from "./slices/system/gitlabSlice";
import { createOnboardingSlice, isOnboardingStep, ONBOARDING_STEPS } from "./slices/system/onboardingSlice";
import * as Sentry from "@sentry/react";
import { createTourSlice } from "./slices/system/tourSlice";
import { createDevToolsSlice } from "./slices/system/devToolsSlice";
import { createFleetSlice } from "./slices/system/fleetSlice";
import { createNetworkSlice } from "./slices/network/networkSlice";
import { createSetupSlice } from "./slices/system/setupSlice";
import { createAmbientContextSlice } from "./slices/system/ambientContextSlice";
import { createArtistSlice } from "./slices/system/artistSlice";
import { createObsidianBrainSlice } from "./slices/system/obsidianBrainSlice";
import { createResearchLabSlice } from "./slices/system/researchLabSlice";
import { createTwinSlice } from "./slices/system/twinSlice";
import { createCompanionPluginSlice } from "./slices/system/companionPluginSlice";
import { createRadioSlice } from "./slices/system/radioSlice";
import { silentCatch } from '@/lib/silentCatch';


export const useSystemStore = create<SystemStore>()(
  persist(
    (...a) => ({
      errorKind: null,
      sliceErrors: {},
      ...createUiSlice(...a),
      ...createCloudSlice(...a),
      ...createGitLabSlice(...a),
      ...createOnboardingSlice(...a),
      ...createTourSlice(...a),
      ...createDevToolsSlice(...a),
      ...createFleetSlice(...a),
      ...createNetworkSlice(...a),
      ...createSetupSlice(...a),
      ...createAmbientContextSlice(...a),
      ...createArtistSlice(...a),
      ...createObsidianBrainSlice(...a),
      ...createResearchLabSlice(...a),
      ...createTwinSlice(...a),
      ...createCompanionPluginSlice(...a),
      ...createRadioSlice(...a),
    }),
    {
      name: "persona-ui-system",
      storage: createDedupedJSONStorage(),
      partialize: (state) => ({
        sidebarSection: state.sidebarSection,
        // Persist the active dev project so Goals (and other dev-tools surfaces)
        // re-fetch their data after a hard refresh. Without this it reset to null
        // on reload, and goals — though safely in SQLite — never re-fetched.
        activeProjectId: state.activeProjectId,
        fleetNotifyAwaiting: state.fleetNotifyAwaiting,
        fleetAutoHibernate: state.fleetAutoHibernate,
        fleetAutoHibernateMinutes: state.fleetAutoHibernateMinutes,
        fleetActiveSessionId: state.fleetActiveSessionId,
        fleetTerminalFontSize: state.fleetTerminalFontSize,
        fleetTerminalCopyOnSelect: state.fleetTerminalCopyOnSelect,
        fleetTerminalTheme: state.fleetTerminalTheme,
        homeTab: state.homeTab,
        editorTab: state.editorTab,
        designSubTab: state.designSubTab,
        cloudTab: state.cloudTab,
        settingsTab: state.settingsTab,
        onboardingCompleted: state.onboardingCompleted,
        onboardingDismissedAtStep: state.onboardingDismissedAtStep,
        onboardingStepCompleted: state.onboardingStepCompleted,
        tourCompleted: state.tourCompleted,
        tourDismissed: state.tourDismissed,
        setupRole: state.setupRole,
        setupTool: state.setupTool,
        setupGoal: state.setupGoal,
        setupCompleted: state.setupCompleted,
        // The active plugin module (Browse / Drive / Twin / Companion / …)
        // persists like every sibling sub-tab below, so re-entering the
        // Plugins section after navigating away or restarting restores the
        // last-viewed plugin instead of snapping back to the Browse grid.
        pluginTab: state.pluginTab,
        artistTab: state.artistTab,
        artistFolder: state.artistFolder,
        creativeSessions: state.creativeSessions,
        mediaStudioRecents: state.mediaStudioRecents,
        obsidianBrainTab: state.obsidianBrainTab,
        obsidianVaultPath: state.obsidianVaultPath,
        twinTab: state.twinTab,
        companionPluginTab: state.companionPluginTab,
        companionFooterEnabled: state.companionFooterEnabled,
        companionPanelCompact: state.companionPanelCompact,
        companionOrbEnabled: state.companionOrbEnabled,
        companionOrbPos: state.companionOrbPos,
        companionSttEngine: state.companionSttEngine,
        companionSttModelId: state.companionSttModelId,
        companionSoundEnabled: state.companionSoundEnabled,
        companionVoiceEnabled: state.companionVoiceEnabled,
        companionVoiceEngine: state.companionVoiceEngine,
        companionVoiceCredentialId: state.companionVoiceCredentialId,
        companionVoiceId: state.companionVoiceId,
        companionPiperVoiceId: state.companionPiperVoiceId,
        companionVoiceModel: state.companionVoiceModel,
        companionVoiceStability: state.companionVoiceStability,
        companionVoiceSimilarity: state.companionVoiceSimilarity,
        companionVoiceSpeed: state.companionVoiceSpeed,
        companionVoiceStyle: state.companionVoiceStyle,
        companionVoiceVolume: state.companionVoiceVolume,
        companionRecallSynthesisEnabled: state.companionRecallSynthesisEnabled,
        companionAutonomousMode: state.companionAutonomousMode,
        companionHandsFreeDecisions: state.companionHandsFreeDecisions,
        radioEnabled: state.radioEnabled,
        disabledStationIds: state.disabledStationIds,
        radioAutoResume: state.radioAutoResume,
        collapsedSourceKinds: state.collapsedSourceKinds,
        monitorGroupBy: state.monitorGroupBy,
        monitorCollapsedGroups: state.monitorCollapsedGroups,
        homeHiddenSections: state.homeHiddenSections,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Sidebar schema drift: the 'goals' 1st-level section was rebranded
        // to 'teams' (Goals consolidated under Teams, 2026-06-05). Map the
        // legacy persisted value so returning users land on the same surface.
        if ((state.sidebarSection as string) === 'goals') {
          state.sidebarSection = 'teams';
          state.teamsTab = 'goals';
        }

        // Guard against onboarding schema drift: if a persisted step id no
        // longer exists in the current enum (app update renamed/removed a
        // step), discard the stale value so the overlay doesn't render blank
        // on resume. Log the mismatch so we can tell how often it happens.
        if (
          state.onboardingDismissedAtStep != null &&
          !isOnboardingStep(state.onboardingDismissedAtStep)
        ) {
          try {
            Sentry.addBreadcrumb({
              category: 'onboarding',
              level: 'warning',
              message: 'Discarding unknown onboardingDismissedAtStep on hydrate',
              data: { persisted: String(state.onboardingDismissedAtStep) },
            });
          } catch (err) { silentCatch("stores/systemStore:catch1")(err); }
          state.onboardingDismissedAtStep = null;
        }

        // Trim unknown keys from the step-completed record so a renamed step
        // can't keep a stale completed-bit around.
        if (state.onboardingStepCompleted && typeof state.onboardingStepCompleted === 'object') {
          const cleaned: Record<string, boolean> = {};
          for (const step of ONBOARDING_STEPS) {
            cleaned[step] = Boolean((state.onboardingStepCompleted as Record<string, boolean>)[step]);
          }
          state.onboardingStepCompleted = cleaned as typeof state.onboardingStepCompleted;
        }
        // Migrate legacy editor tabs that were consolidated into the Design hub.
        const legacyTab = state.editorTab as unknown as string;
        if (legacyTab === 'prompt') {
          state.editorTab = 'design';
          state.designSubTab = 'prompt';
        } else if (legacyTab === 'connectors') {
          state.editorTab = 'design';
          state.designSubTab = 'connectors';
        } else if (legacyTab === 'health') {
          state.editorTab = 'design';
          state.designSubTab = 'prompt';
        } else if (legacyTab === 'use-cases') {
          state.editorTab = 'design';
          state.designSubTab = 'use-cases';
        }
        // Migrate legacy designSubTab value: 'design' (former LLM-wizard tab) → 'prompt'.
        const legacySubTab = state.designSubTab as unknown as string;
        if (legacySubTab === 'design') {
          state.designSubTab = 'prompt';
        }
      },
    },
  ),
);
