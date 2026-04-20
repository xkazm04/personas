import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { TwinTab } from "@/lib/types/types";
import type { TwinProfile } from "@/lib/bindings/TwinProfile";
import type { TwinTone } from "@/lib/bindings/TwinTone";
import type { TwinPendingMemory } from "@/lib/bindings/TwinPendingMemory";
import type { TwinCommunication } from "@/lib/bindings/TwinCommunication";
import type { TwinVoiceProfile } from "@/lib/bindings/TwinVoiceProfile";
import type { TwinChannel } from "@/lib/bindings/TwinChannel";
import * as twinApi from "@/api/twin/twin";
import type {
  TwinChannelKind,
  TwinInteractionDirection,
  TwinPendingMemoryStatus,
} from "@/api/enums";

// ============================================================================
// Twin slice (P0 + P1 + P2)
//
// Mirrors the devToolsProjectSlice pattern: list of profiles, an active id,
// CRUD actions, and a sub-tab pointer for the TwinPage. P1 adds tone
// profiles (per-channel voice directives).
// ============================================================================

export interface TwinSlice {
  // -- State -----------------------------------------------------------
  twinProfiles: TwinProfile[];
  activeTwinId: string | null;
  twinProfilesLoading: boolean;
  twinTab: TwinTab;

  // -- Tone state (P1) ------------------------------------------------
  twinTones: TwinTone[];
  twinTonesLoading: boolean;

  // -- Memory state (P2) -----------------------------------------------
  twinPendingMemories: TwinPendingMemory[];
  twinPendingLoading: boolean;
  twinCommunications: TwinCommunication[];
  twinCommsLoading: boolean;

  // -- Voice state (P3) ------------------------------------------------
  twinVoiceProfile: TwinVoiceProfile | null;
  twinVoiceLoading: boolean;

  // -- Channels state (P4) ---------------------------------------------
  twinChannels: TwinChannel[];
  twinChannelsLoading: boolean;

  // -- Actions ---------------------------------------------------------
  setTwinTab: (tab: TwinTab) => void;
  fetchTwinProfiles: () => Promise<void>;
  createTwinProfile: (
    name: string,
    bio?: string,
    role?: string,
    languages?: string,
    pronouns?: string,
  ) => Promise<TwinProfile>;
  updateTwinProfile: (
    id: string,
    updates: {
      name?: string;
      bio?: string | null;
      role?: string | null;
      languages?: string | null;
      pronouns?: string | null;
      obsidianSubpath?: string;
    },
  ) => Promise<void>;
  deleteTwinProfile: (id: string) => Promise<void>;
  setActiveTwin: (id: string) => Promise<void>;

  // -- Tone actions (P1) -----------------------------------------------
  fetchTwinTones: (twinId: string) => Promise<void>;
  upsertTwinTone: (
    twinId: string,
    channel: TwinChannelKind,
    voiceDirectives: string,
    examplesJson?: string | null,
    constraintsJson?: string | null,
    lengthHint?: string | null,
  ) => Promise<TwinTone>;
  deleteTwinTone: (id: string) => Promise<void>;

  // -- Knowledge base actions (P2) -------------------------------------
  bindTwinKnowledgeBase: (twinId: string, kbId: string) => Promise<void>;
  unbindTwinKnowledgeBase: (twinId: string) => Promise<void>;

  // -- Pending memory actions (P2) -------------------------------------
  fetchTwinPendingMemories: (twinId: string, status?: TwinPendingMemoryStatus) => Promise<void>;
  reviewTwinMemory: (id: string, approved: boolean, reviewerNotes?: string) => Promise<void>;

  // -- Communication actions (P2) --------------------------------------
  fetchTwinCommunications: (twinId: string, channel?: TwinChannelKind, limit?: number) => Promise<void>;
  recordTwinInteraction: (
    twinId: string,
    channel: TwinChannelKind,
    direction: TwinInteractionDirection,
    content: string,
    contactHandle?: string,
    summary?: string,
    keyFactsJson?: string,
    createMemory?: boolean,
  ) => Promise<TwinCommunication>;

  // -- Voice actions (P3) ------------------------------------------------
  fetchTwinVoiceProfile: (twinId: string) => Promise<void>;
  upsertTwinVoiceProfile: (
    twinId: string,
    voiceId: string,
    credentialId?: string | null,
    modelId?: string | null,
    stability?: number,
    similarityBoost?: number,
    style?: number,
  ) => Promise<TwinVoiceProfile>;
  deleteTwinVoiceProfile: (twinId: string) => Promise<void>;

  // -- Channel actions (P4) ---------------------------------------------
  fetchTwinChannels: (twinId: string) => Promise<void>;
  createTwinChannel: (
    twinId: string,
    channelType: TwinChannelKind,
    credentialId: string,
    personaId?: string,
    label?: string,
  ) => Promise<TwinChannel>;
  updateTwinChannel: (
    id: string,
    updates: { personaId?: string | null; label?: string | null; isActive?: boolean },
  ) => Promise<void>;
  deleteTwinChannel: (id: string) => Promise<void>;
}

export const createTwinSlice: StateCreator<SystemStore, [], [], TwinSlice> = (set, get) => ({
  twinProfiles: [],
  activeTwinId: null,
  twinProfilesLoading: false,
  twinTab: "profiles" as TwinTab,
  twinTones: [],
  twinTonesLoading: false,
  twinPendingMemories: [],
  twinPendingLoading: false,
  twinCommunications: [],
  twinCommsLoading: false,
  twinVoiceProfile: null,
  twinVoiceLoading: false,
  twinChannels: [],
  twinChannelsLoading: false,

  setTwinTab: (tab) => set({ twinTab: tab }),

  fetchTwinProfiles: async () => {
    set({ twinProfilesLoading: true });
    try {
      const twinProfiles = await twinApi.listProfiles();
      const active = twinProfiles.find((t) => t.is_active) ?? null;
      set({
        twinProfiles,
        activeTwinId: active?.id ?? null,
        twinProfilesLoading: false,
        error: null,
      });
    } catch (err) {
      reportError(err, "Failed to fetch twin profiles", set, {
        stateUpdates: { twinProfilesLoading: false },
      });
    }
  },

  createTwinProfile: async (name, bio, role, languages, pronouns) => {
    try {
      const profile = await twinApi.createProfile(name, bio, role, languages, pronouns);
      set((state) => {
        // Backend auto-activates the very first twin -- mirror that on the
        // client so the selector immediately reflects reality without a refetch.
        const wasFirst = state.twinProfiles.length === 0;
        return {
          twinProfiles: [...state.twinProfiles, profile],
          activeTwinId: wasFirst ? profile.id : state.activeTwinId,
          error: null,
        };
      });
      return profile;
    } catch (err) {
      reportError(err, "Failed to create twin profile", set);
      throw err;
    }
  },

  updateTwinProfile: async (id, updates) => {
    try {
      const updated = await twinApi.updateProfile(id, updates);
      set((state) => ({
        twinProfiles: state.twinProfiles.map((p) => (p.id === id ? updated : p)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update twin profile", set);
    }
  },

  deleteTwinProfile: async (id) => {
    try {
      await twinApi.deleteProfile(id);
      set((state) => ({
        twinProfiles: state.twinProfiles.filter((p) => p.id !== id),
        activeTwinId: state.activeTwinId === id ? null : state.activeTwinId,
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete twin profile", set);
    }
  },

  setActiveTwin: async (id) => {
    try {
      await twinApi.setActiveProfile(id);
      // Re-fetch so every row's is_active flag stays in sync with the
      // single-active invariant the backend enforces.
      await get().fetchTwinProfiles();
    } catch (err) {
      reportError(err, "Failed to set active twin", set);
    }
  },

  // -- Tone actions (P1) -----------------------------------------------

  fetchTwinTones: async (twinId) => {
    set({ twinTonesLoading: true });
    try {
      const twinTones = await twinApi.listTones(twinId);
      set({ twinTones, twinTonesLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch twin tones", set, {
        stateUpdates: { twinTonesLoading: false },
      });
    }
  },

  upsertTwinTone: async (twinId, channel, voiceDirectives, examplesJson, constraintsJson, lengthHint) => {
    try {
      const tone = await twinApi.upsertTone(twinId, channel, voiceDirectives, examplesJson, constraintsJson, lengthHint);
      set((state) => {
        const existing = state.twinTones.findIndex(
          (t) => t.twin_id === twinId && t.channel === channel,
        );
        if (existing >= 0) {
          const updated = [...state.twinTones];
          updated[existing] = tone;
          return { twinTones: updated, error: null };
        }
        return { twinTones: [...state.twinTones, tone], error: null };
      });
      return tone;
    } catch (err) {
      reportError(err, "Failed to save twin tone", set);
      throw err;
    }
  },

  deleteTwinTone: async (id) => {
    try {
      await twinApi.deleteTone(id);
      set((state) => ({
        twinTones: state.twinTones.filter((t) => t.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete twin tone", set);
    }
  },

  // -- Knowledge base actions (P2) -------------------------------------

  bindTwinKnowledgeBase: async (twinId, kbId) => {
    try {
      const updated = await twinApi.bindKnowledgeBase(twinId, kbId);
      set((state) => ({
        twinProfiles: state.twinProfiles.map((p) => (p.id === twinId ? updated : p)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to bind knowledge base", set);
    }
  },

  unbindTwinKnowledgeBase: async (twinId) => {
    try {
      const updated = await twinApi.unbindKnowledgeBase(twinId);
      set((state) => ({
        twinProfiles: state.twinProfiles.map((p) => (p.id === twinId ? updated : p)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to unbind knowledge base", set);
    }
  },

  // -- Pending memory actions (P2) -------------------------------------

  fetchTwinPendingMemories: async (twinId, status) => {
    set({ twinPendingLoading: true });
    try {
      const twinPendingMemories = await twinApi.listPendingMemories(twinId, status);
      set({ twinPendingMemories, twinPendingLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch pending memories", set, {
        stateUpdates: { twinPendingLoading: false },
      });
    }
  },

  reviewTwinMemory: async (id, approved, reviewerNotes) => {
    try {
      const reviewed = await twinApi.reviewMemory(id, approved, reviewerNotes);
      set((state) => ({
        twinPendingMemories: state.twinPendingMemories.map((m) =>
          m.id === id ? reviewed : m,
        ),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to review memory", set);
    }
  },

  // -- Communication actions (P2) --------------------------------------

  fetchTwinCommunications: async (twinId, channel, limit) => {
    set({ twinCommsLoading: true });
    try {
      const twinCommunications = await twinApi.listCommunications(twinId, channel, limit);
      set({ twinCommunications, twinCommsLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch communications", set, {
        stateUpdates: { twinCommsLoading: false },
      });
    }
  },

  recordTwinInteraction: async (twinId, channel, direction, content, contactHandle, summary, keyFactsJson, createMemory) => {
    try {
      const comm = await twinApi.recordInteraction(twinId, channel, direction, content, contactHandle, summary, keyFactsJson, createMemory);
      set((state) => ({
        twinCommunications: [comm, ...state.twinCommunications],
        error: null,
      }));
      return comm;
    } catch (err) {
      reportError(err, "Failed to record interaction", set);
      throw err;
    }
  },

  // -- Voice actions (P3) ------------------------------------------------

  fetchTwinVoiceProfile: async (twinId) => {
    set({ twinVoiceLoading: true });
    try {
      const twinVoiceProfile = await twinApi.getVoiceProfile(twinId);
      set({ twinVoiceProfile, twinVoiceLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch voice profile", set, {
        stateUpdates: { twinVoiceLoading: false },
      });
    }
  },

  upsertTwinVoiceProfile: async (twinId, voiceId, credentialId, modelId, stability, similarityBoost, style) => {
    try {
      const profile = await twinApi.upsertVoiceProfile(twinId, voiceId, credentialId, modelId, stability, similarityBoost, style);
      set({ twinVoiceProfile: profile, error: null });
      return profile;
    } catch (err) {
      reportError(err, "Failed to save voice profile", set);
      throw err;
    }
  },

  deleteTwinVoiceProfile: async (twinId) => {
    try {
      await twinApi.deleteVoiceProfile(twinId);
      set({ twinVoiceProfile: null, error: null });
    } catch (err) {
      reportError(err, "Failed to delete voice profile", set);
    }
  },

  // -- Channel actions (P4) ---------------------------------------------

  fetchTwinChannels: async (twinId) => {
    set({ twinChannelsLoading: true });
    try {
      const twinChannels = await twinApi.listChannels(twinId);
      set({ twinChannels, twinChannelsLoading: false, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch channels", set, {
        stateUpdates: { twinChannelsLoading: false },
      });
    }
  },

  createTwinChannel: async (twinId, channelType, credentialId, personaId, label) => {
    try {
      const channel = await twinApi.createChannel(twinId, channelType, credentialId, personaId, label);
      set((state) => ({
        twinChannels: [...state.twinChannels, channel],
        error: null,
      }));
      return channel;
    } catch (err) {
      reportError(err, "Failed to create channel", set);
      throw err;
    }
  },

  updateTwinChannel: async (id, updates) => {
    try {
      const updated = await twinApi.updateChannel(id, updates);
      set((state) => ({
        twinChannels: state.twinChannels.map((c) => (c.id === id ? updated : c)),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to update channel", set);
    }
  },

  deleteTwinChannel: async (id) => {
    try {
      await twinApi.deleteChannel(id);
      set((state) => ({
        twinChannels: state.twinChannels.filter((c) => c.id !== id),
        error: null,
      }));
    } catch (err) {
      reportError(err, "Failed to delete channel", set);
    }
  },
});
