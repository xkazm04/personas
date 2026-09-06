/**
 * System domain store -- UI chrome, cloud, GitLab, onboarding, dev-tools,
 * network / P2P, and setup wizard.
 *
 * The guided tour used to live here as `tourSlice`; it now has its own
 * standalone `useTourStore` (src/stores/tourStore.ts) — see docs ADR
 * "tour-slice-extraction".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createCoreState, type SystemStore } from "./storeTypes";
import type { DesignSubTab } from "@/lib/types/types";
import { createDedupedJSONStorage } from "./util/dedupedStorage";

import { createUiSlice } from "./slices/system/uiSlice";
import { createCloudSlice } from "./slices/system/cloudSlice";
import { createGitLabSlice } from "./slices/system/gitlabSlice";
import { createOnboardingSlice, isOnboardingStep, ONBOARDING_STEPS } from "./slices/system/onboardingSlice";
import * as Sentry from "@sentry/react";
import { createDevToolsSlice } from "./slices/system/devToolsSlice";
import { createFleetSlice } from "./slices/system/fleetSlice";
import { createNotepadSlice } from "./slices/system/notepadSlice";
import { createNetworkSlice } from "./slices/network/networkSlice";
import { createDevicesSlice } from "./slices/network/devicesSlice";
import { createRemoteJobsSlice } from "./slices/network/remoteJobsSlice";
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
      ...createCoreState(),
      ...createUiSlice(...a),
      ...createCloudSlice(...a),
      ...createGitLabSlice(...a),
      ...createOnboardingSlice(...a),
      ...createDevToolsSlice(...a),
      ...createFleetSlice(...a),
      ...createNotepadSlice(...a),
      ...createNetworkSlice(...a),
      ...createDevicesSlice(...a),
      ...createRemoteJobsSlice(...a),
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
        fleetLiveSlotsEnabled: state.fleetLiveSlotsEnabled,
        fleetMaxLiveSessions: state.fleetMaxLiveSessions,
        fleetStaleMinutes: state.fleetStaleMinutes,
        fleetFrozenMinutes: state.fleetFrozenMinutes,
        fleetActiveSessionId: state.fleetActiveSessionId,
        // Which note you had open is a preference; whether the overlay was
        // RAISED is not — see notepadSlice's header.
        notepadActiveNoteId: state.notepadActiveNoteId,
        fleetTerminalFontSize: state.fleetTerminalFontSize,
        fleetTerminalCopyOnSelect: state.fleetTerminalCopyOnSelect,
        fleetTerminalTheme: state.fleetTerminalTheme,
        homeTab: state.homeTab,
        // Acknowledged "What's New" version — persisted so the update dot
        // doesn't re-light on every relaunch after the user has seen it.
        whatsNewSeenVersion: state.whatsNewSeenVersion,
        editorTab: state.editorTab,
        designSubTab: state.designSubTab,
        cloudTab: state.cloudTab,
        settingsTab: state.settingsTab,
        onboardingCompleted: state.onboardingCompleted,
        onboardingDismissedAtStep: state.onboardingDismissedAtStep,
        onboardingStepCompleted: state.onboardingStepCompleted,
        // tourCompleted/tourDismissed used to be redundantly persisted here as
        // well as tourSlice's own `guided-tour-state` localStorage key. The
        // tour slice moved to its own standalone `useTourStore` (see docs ADR
        // "tour-slice-extraction") and owns its persistence directly, so these
        // two keys were dropped. A stale "persona-ui-system" blob still
        // carrying them is harmless — zustand's persist merge ignores extra
        // keys on rehydrate.
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
        companionSidePanelSlot: state.companionSidePanelSlot,
        companionOrbEnabled: state.companionOrbEnabled,
        companionOrbPos: state.companionOrbPos,
        companionSttEngine: state.companionSttEngine,
        companionSttModelId: state.companionSttModelId,
        companionGlobalHotkeyEnabled: state.companionGlobalHotkeyEnabled,
        companionSoundEnabled: state.companionSoundEnabled,
        companionVoiceEnabled: state.companionVoiceEnabled,
        companionVoiceEngine: state.companionVoiceEngine,
        companionKokoroVoiceId: state.companionKokoroVoiceId,
        companionPocketVoiceId: state.companionPocketVoiceId,
        companionVoiceSpeed: state.companionVoiceSpeed,
        companionVoiceVolume: state.companionVoiceVolume,
        companionRecallSynthesisEnabled: state.companionRecallSynthesisEnabled,
        companionAutonomousMode: state.companionAutonomousMode,
        companionDevMode: state.companionDevMode,
        companionHandsFreeDecisions: state.companionHandsFreeDecisions,
        companionAlertsExpanded: state.companionAlertsExpanded,
        radioEnabled: state.radioEnabled,
        disabledStationIds: state.disabledStationIds,
        radioAutoResume: state.radioAutoResume,
        collapsedSourceKinds: state.collapsedSourceKinds,
        monitorGroupBy: state.monitorGroupBy,
        monitorCollapsedGroups: state.monitorCollapsedGroups,
        monitorLiveMode: state.monitorLiveMode,
        homeHiddenSections: state.homeHiddenSections,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Notepad: the persisted active-note id is a hint the store resolves
        // on load (a deleted or archived note falls back to the first tab).
        // Anything that is not a string is drift from an older shape — drop it
        // rather than hand the tab strip a value it cannot match.
        if (state.notepadActiveNoteId != null && typeof state.notepadActiveNoteId !== 'string') {
          state.notepadActiveNoteId = null;
        }

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
        // INVARIANT for the cast: the value came back through JSON.parse from a
        // localStorage blob an OLDER BUILD wrote, so its real type is `unknown`
        // and the declared union constrains nothing here. Read it as a string,
        // decide, then write a value from the CURRENT union.
        const legacyTab = state.editorTab as unknown as string;
        if (legacyTab === 'prompt') {
          state.editorTab = 'design';
          state.designSubTab = 'manifest';
        } else if (legacyTab === 'connectors') {
          state.editorTab = 'design';
          state.designSubTab = 'connectors';
        } else if (legacyTab === 'health') {
          state.editorTab = 'design';
          state.designSubTab = 'manifest';
        } else if (legacyTab === 'use-cases') {
          // Use cases became standing charters with the agent-manifest rebase.
          state.editorTab = 'design';
          state.designSubTab = 'responsibilities';
        } else if (legacyTab === 'life') {
          // The top-level Life tab (living-agent surface) folded into the
          // Design hub; its Core half is the Manifest tab now.
          state.editorTab = 'design';
          state.designSubTab = 'manifest';
        }

        // Remap every retired designSubTab value onto the four that remain
        // (agent-manifest rebase, 2026-09-04). A REMAP, not a discard: the
        // surface moved, so land the user on the tab that inherited its job.
        // The trailing guard covers anything not named here — including a
        // value written by a NEWER build the user has rolled back from, which
        // is the case that has no entry in any table by construction.
        const RETIRED_SUB_TABS: Record<string, DesignSubTab> = {
          design: 'manifest',
          prompt: 'manifest',
          parameters: 'manifest',
          core: 'manifest',
          'use-cases': 'responsibilities',
          triggers: 'connectors',
          messaging: 'connectors',
          automations: 'connectors',
        };
        const LIVE_SUB_TABS: readonly DesignSubTab[] = [
          'manifest',
          'responsibilities',
          'brain',
          'connectors',
        ];
        // Same invariant as `legacyTab` above: a persisted token, not a union.
        const persistedSubTab = state.designSubTab as unknown as string;
        const remapped = RETIRED_SUB_TABS[persistedSubTab];
        if (remapped) {
          state.designSubTab = remapped;
        } else if (!LIVE_SUB_TABS.includes(state.designSubTab)) {
          state.designSubTab = 'manifest';
        }
      },
    },
  ),
);
