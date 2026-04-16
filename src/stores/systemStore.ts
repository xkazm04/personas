/**
 * System domain store -- UI chrome, cloud, GitLab, onboarding, guided tour,
 * view-mode, dev-tools, network / P2P, and setup wizard.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SystemStore } from "./storeTypes";

import { createUiSlice } from "./slices/system/uiSlice";
import { createCloudSlice } from "./slices/system/cloudSlice";
import { createGitLabSlice } from "./slices/system/gitlabSlice";
import { createOnboardingSlice } from "./slices/system/onboardingSlice";
import { createTourSlice } from "./slices/system/tourSlice";
import { createViewModeSlice } from "./slices/system/viewModeSlice";
import { createDevToolsSlice } from "./slices/system/devToolsSlice";
import { createNetworkSlice } from "./slices/network/networkSlice";
import { createSetupSlice } from "./slices/system/setupSlice";
import { createAmbientContextSlice } from "./slices/system/ambientContextSlice";
import { createArtistSlice } from "./slices/system/artistSlice";
import { createObsidianBrainSlice } from "./slices/system/obsidianBrainSlice";
import { createResearchLabSlice } from "./slices/system/researchLabSlice";
import { createTwinSlice } from "./slices/system/twinSlice";
import { TIER_RANK, DEFAULT_TIER } from "@/lib/constants/uiModes";

/** Migrate legacy viewMode values ('simple'|'full'|'dev') persisted before the tier rename. */
const LEGACY_MAP: Record<string, string> = { simple: 'starter', full: 'team', dev: 'builder' };

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
      ...createViewModeSlice(...a),
      ...createDevToolsSlice(...a),
      ...createNetworkSlice(...a),
      ...createSetupSlice(...a),
      ...createAmbientContextSlice(...a),
      ...createArtistSlice(...a),
      ...createObsidianBrainSlice(...a),
      ...createResearchLabSlice(...a),
      ...createTwinSlice(...a),
    }),
    {
      name: "persona-ui-system",
      partialize: (state) => ({
        sidebarSection: state.sidebarSection,
        homeTab: state.homeTab,
        editorTab: state.editorTab,
        cloudTab: state.cloudTab,
        settingsTab: state.settingsTab,
        onboardingCompleted: state.onboardingCompleted,
        onboardingDismissedAtStep: state.onboardingDismissedAtStep,
        onboardingStepCompleted: state.onboardingStepCompleted,
        tourCompleted: state.tourCompleted,
        tourDismissed: state.tourDismissed,
        viewMode: state.viewMode,
        setupRole: state.setupRole,
        setupTool: state.setupTool,
        setupGoal: state.setupGoal,
        setupCompleted: state.setupCompleted,
        artistTab: state.artistTab,
        artistFolder: state.artistFolder,
        creativeSessions: state.creativeSessions,
        obsidianBrainTab: state.obsidianBrainTab,
        obsidianVaultPath: state.obsidianVaultPath,
        twinTab: state.twinTab,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const raw = state.viewMode;
        if (typeof raw === 'string' && !(raw in TIER_RANK)) {
          // Migrate legacy value
          state.viewMode = (LEGACY_MAP[raw] ?? DEFAULT_TIER) as typeof state.viewMode;
        }
      },
    },
  ),
);
