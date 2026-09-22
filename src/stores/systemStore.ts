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
import { ALL_SIDEBAR_SECTIONS } from "@/lib/navigation/registry";
import { COMPANIONS_PAGES, type CompanionsPage } from "@/features/companions/types";

import { createUiSlice } from "./slices/system/uiSlice";
import { createCloudSlice } from "./slices/system/cloudSlice";
import { createGitLabSlice } from "./slices/system/gitlabSlice";
import { createOnboardingSlice, isOnboardingStep, ONBOARDING_STEPS } from "./slices/system/onboardingSlice";
import { isCreateAthenaStepId } from "@/features/companions/athena/sub_create/engine/createAthenaTypes";
import * as Sentry from "@sentry/react";
import { createDevToolsSlice } from "./slices/system/devToolsSlice";
import { createFleetSlice } from "./slices/system/fleetSlice";
import { createNotepadSlice } from "./slices/system/notepadSlice";
import { createNetworkSlice } from "./slices/network/networkSlice";
import { createDevicesSlice } from "./slices/network/devicesSlice";
import { createRemoteJobsSlice } from "./slices/network/remoteJobsSlice";
import { createSetupSlice } from "./slices/system/setupSlice";
import { createAmbientContextSlice } from "./slices/system/ambientContextSlice";
import { createObsidianBrainSlice } from "./slices/system/obsidianBrainSlice";
import { createTwinSlice } from "./slices/system/twinSlice";
import { createAthenaSlice, remapLegacyAthenaFields } from "./slices/system/athenaSlice";
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
      ...createObsidianBrainSlice(...a),
      ...createTwinSlice(...a),
      ...createAthenaSlice(...a),
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
        // The reconcile banner's dismissal, NOT the orphans themselves: the
        // orphan list is re-derived on every connect, so what has to survive a
        // relaunch is only whether the banner is folded away. The badge is
        // driven by the re-derived list, so a dismissed warning still shows a
        // count instead of disappearing.
        cloudReconcileDismissed: state.cloudReconcileDismissed,
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
        // The Companions destination (landing, or `<companion>:<page>`) — one
        // field, persisted like every sibling sub-tab above.
        companionsPage: state.companionsPage,
        obsidianBrainTab: state.obsidianBrainTab,
        obsidianVaultPath: state.obsidianVaultPath,
        twinTab: state.twinTab,
        athenaFooterEnabled: state.athenaFooterEnabled,
        athenaPanelCompact: state.athenaPanelCompact,
        athenaSidePanelSlot: state.athenaSidePanelSlot,
        athenaOrbEnabled: state.athenaOrbEnabled,
        athenaOrbPos: state.athenaOrbPos,
        athenaSttEngine: state.athenaSttEngine,
        athenaSttModelId: state.athenaSttModelId,
        athenaGlobalHotkeyEnabled: state.athenaGlobalHotkeyEnabled,
        athenaSoundEnabled: state.athenaSoundEnabled,
        athenaVoiceEnabled: state.athenaVoiceEnabled,
        athenaVoiceEngine: state.athenaVoiceEngine,
        athenaKokoroVoiceId: state.athenaKokoroVoiceId,
        athenaPocketVoiceId: state.athenaPocketVoiceId,
        athenaVoiceSpeed: state.athenaVoiceSpeed,
        athenaVoiceVolume: state.athenaVoiceVolume,
        athenaRecallSynthesisEnabled: state.athenaRecallSynthesisEnabled,
        athenaAutonomousMode: state.athenaAutonomousMode,
        athenaDevMode: state.athenaDevMode,
        athenaHandsFreeDecisions: state.athenaHandsFreeDecisions,
        athenaAlertsExpanded: state.athenaAlertsExpanded,
        athenaOnboardingStep: state.athenaOnboardingStep,
        athenaOnboardingCompletedAt: state.athenaOnboardingCompletedAt,
        radioEnabled: state.radioEnabled,
        disabledStationIds: state.disabledStationIds,
        radioAutoResume: state.radioAutoResume,
        collapsedSourceKinds: state.collapsedSourceKinds,
        monitorGroupBy: state.monitorGroupBy,
        monitorCollapsedGroups: state.monitorCollapsedGroups,
        monitorLiveMode: state.monitorLiveMode,
        homeHiddenSections: state.homeHiddenSections,
      }),
      /**
       * Zustand's default merge, plus the one rename this blob has to survive:
       * Athena's settings were persisted under `companion*` names before the
       * Companions rename. Doing it here rather than in `onRehydrateStorage`
       * is deliberate — `merge` sees the stored blob itself, so the old value
       * is on the new field before the store is ever `set`, and no consumer
       * can read the default in between.
       */
      merge: (persisted, current) => ({
        ...current,
        ...remapLegacyAthenaFields(persisted),
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
        // Create Athena: a persisted step id a newer build no longer knows
        // (a step renamed or removed) would strand the wizard on a step with
        // no line and no card. Discard it; the wizard restarts at the intro.
        if (state.athenaOnboardingStep != null && !isCreateAthenaStepId(state.athenaOnboardingStep)) {
          state.athenaOnboardingStep = null;
        }

        if ((state.sidebarSection as string) === 'goals') {
          state.sidebarSection = 'teams';
          state.teamsTab = 'goals';
        }

        // Athena stopped being a plugin on 2026-09-22 and became the first of
        // three built-in companions. Two persisted values carried the old shape
        // and both are REMAPPED, never discarded: a user parked on her surface
        // must land on the same surface under its new address.
        //
        // INVARIANT for the casts below: these came back through JSON.parse from
        // a blob an OLDER BUILD wrote, so their real type is `unknown` and the
        // declared union constrains nothing. Read as strings, decide, then write
        // a value from the CURRENT vocabulary.
        const persisted = state as unknown as Record<string, unknown>;
        const legacyAthenaTab = persisted.companionPluginTab;
        if (typeof legacyAthenaTab === 'string') {
          const migrated = `athena:${legacyAthenaTab}` as CompanionsPage;
          if ((COMPANIONS_PAGES as readonly string[]).includes(migrated)) {
            state.companionsPage = migrated;
          }
          // The field itself is gone from `partialize`, so the next write drops
          // it; deleting it here keeps it from shadowing anything in between.
          delete persisted.companionPluginTab;
        }
        if ((state.sidebarSection as string) === 'plugins' && (state.pluginTab as string) === 'companion') {
          state.sidebarSection = 'companions';
          // `companion` is no longer a PluginTab, so leaving it would strand the
          // Plugins section on a tab nothing answers to the next time it opens.
          state.pluginTab = 'browse';
        }

        // A `companionsPage` this build does not know (a page renamed, or a
        // value a NEWER build wrote before a rollback) lands on the section's
        // default rather than on a rail row that highlights nothing.
        if (!(COMPANIONS_PAGES as readonly string[]).includes(state.companionsPage)) {
          state.companionsPage = 'landing';
        }

        // MEMBERSHIP GUARD — run after every section remap above, so a value
        // with a recorded successor is migrated rather than discarded.
        //
        // An id this build does not know (a section retired since the blob was
        // written, a value a NEWER build wrote before a rollback, or a bad
        // writer — `CompanionAssignmentCards` shipped `'pipeline'` for months)
        // is not merely cosmetic: `navSection()` returns undefined for it and
        // `isSectionGated` — the FIRST statement of `PersonasPage.renderContent`
        // — throws reading `.gates`. `sidebarSection` is persisted, so the crash
        // survived a restart with no way out but clearing localStorage.
        if (!(ALL_SIDEBAR_SECTIONS as readonly string[]).includes(state.sidebarSection)) {
          state.sidebarSection = 'home';
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
