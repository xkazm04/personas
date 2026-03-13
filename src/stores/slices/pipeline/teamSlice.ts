import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import type { PersonaTeam } from "@/lib/bindings/PersonaTeam";
import type { PersonaTeamMember } from "@/lib/bindings/PersonaTeamMember";
import type { PersonaTeamConnection } from "@/lib/bindings/PersonaTeamConnection";
import type { TeamMemory } from "@/lib/bindings/TeamMemory";
import type { TeamMemoryStats } from "@/lib/bindings/TeamMemoryStats";
import type { CreateTeamMemoryInput } from "@/lib/bindings/CreateTeamMemoryInput";
import { batchDeleteTeamMemories, createTeamMemory, deleteTeamMemory, getTeamMemoryCount, getTeamMemoryStats, listTeamMemories, updateTeamMemory, updateTeamMemoryImportance } from "@/api/pipeline/teamMemories";
import { addTeamMember, cloneTeam, createTeam, createTeamConnection, deleteTeam, deleteTeamConnection, listTeamConnections, listTeamMembers, listTeams, removeTeamMember, updateTeamConnection } from "@/api/pipeline/teams";

import { useToastStore } from "@/stores/toastStore";

export interface TeamSlice {
  // State
  teams: PersonaTeam[];
  selectedTeamId: string | null;
  teamMembers: PersonaTeamMember[];
  teamConnections: PersonaTeamConnection[];
  teamMemories: TeamMemory[];
  teamMemoriesTotal: number;
  teamMemoryStats: TeamMemoryStats | null;
  memoryFilterCategory: string | undefined;
  memoryFilterSearch: string | undefined;

  // Actions
  fetchTeams: () => Promise<void>;
  selectTeam: (teamId: string | null) => void;
  fetchTeamDetails: (teamId: string) => Promise<void>;
  createTeam: (data: { name: string; description?: string; icon?: string; color?: string }) => Promise<PersonaTeam | null>;
  cloneTeam: (sourceTeamId: string) => Promise<PersonaTeam | null>;
  deleteTeam: (teamId: string) => Promise<void>;
  addTeamMember: (personaId: string, role?: string, posX?: number, posY?: number) => Promise<PersonaTeamMember | null>;
  removeTeamMember: (memberId: string) => Promise<void>;
  createTeamConnection: (sourceMemberId: string, targetMemberId: string, connectionType?: string, condition?: string, label?: string) => Promise<PersonaTeamConnection | null>;
  deleteTeamConnection: (connectionId: string) => Promise<void>;
  updateTeamConnection: (connectionId: string, connectionType: string) => Promise<void>;
  setMemoryFilters: (category?: string, search?: string) => void;
  fetchTeamMemories: (teamId: string, category?: string, search?: string) => Promise<void>;
  loadMoreTeamMemories: (teamId: string, category?: string, search?: string) => Promise<void>;
  createTeamMemory: (input: CreateTeamMemoryInput) => Promise<TeamMemory | null>;
  deleteTeamMemory: (id: string) => Promise<void>;
  batchDeleteTeamMemories: (ids: string[]) => Promise<void>;
  updateTeamMemoryImportance: (id: string, importance: number) => Promise<void>;
  updateTeamMemory: (id: string, title?: string, content?: string, category?: string, importance?: number) => Promise<void>;
}

export const createTeamSlice: StateCreator<PipelineStore, [], [], TeamSlice> = (set, get) => ({
  teams: [],
  selectedTeamId: null,
  teamMembers: [],
  teamConnections: [],
  teamMemories: [],
  teamMemoriesTotal: 0,
  teamMemoryStats: null,
  memoryFilterCategory: undefined,
  memoryFilterSearch: undefined,

  fetchTeams: async () => {
    try {
      const teams = await listTeams();
      set({ teams });
    } catch {
      useToastStore.getState().addToast('Failed to load teams', 'error');
    }
  },

  selectTeam: (teamId) => {
    set({ selectedTeamId: teamId, teamMembers: [], teamConnections: [], teamMemories: [], teamMemoriesTotal: 0, teamMemoryStats: null, memoryFilterCategory: undefined, memoryFilterSearch: undefined });
    if (teamId) get().fetchTeamDetails(teamId);
  },

  fetchTeamDetails: async (teamId) => {
    try {
      const [members, connections] = await Promise.all([
        listTeamMembers(teamId),
        listTeamConnections(teamId),
      ]);
      set({ teamMembers: members, teamConnections: connections });
      // Also fetch team memories
      get().fetchTeamMemories(teamId);
    } catch {
      useToastStore.getState().addToast('Failed to load team details', 'error');
    }
  },

  createTeam: async (data) => {
    try {
      const team = await createTeam({
        name: data.name,
        project_id: null,
        parent_team_id: null,
        description: data.description ?? null,
        canvas_data: null,
        team_config: null,
        icon: data.icon ?? null,
        color: data.color ?? null,
        enabled: null,
      });
      await get().fetchTeams();
      return team;
    } catch {
      useToastStore.getState().addToast('Failed to create team', 'error');
      return null;
    }
  },

  cloneTeam: async (sourceTeamId) => {
    try {
      const team = await cloneTeam(sourceTeamId);
      await get().fetchTeams();
      useToastStore.getState().addToast('Team forked successfully', 'success');
      return team;
    } catch {
      useToastStore.getState().addToast('Failed to fork team', 'error');
      return null;
    }
  },

  deleteTeam: async (teamId) => {
    try {
      await deleteTeam(teamId);
      if (get().selectedTeamId === teamId) set({ selectedTeamId: null, teamMembers: [], teamConnections: [], teamMemories: [], teamMemoriesTotal: 0, teamMemoryStats: null, memoryFilterCategory: undefined, memoryFilterSearch: undefined });
      await get().fetchTeams();
    } catch {
      useToastStore.getState().addToast('Failed to delete team', 'error');
    }
  },

  addTeamMember: async (personaId, role, posX, posY) => {
    const teamId = get().selectedTeamId;
    if (!teamId) return null;

    // Optimistic: insert a temporary member immediately
    const tempId = `temp-member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: PersonaTeamMember = {
      id: tempId,
      team_id: teamId,
      persona_id: personaId,
      role: role || 'worker',
      position_x: posX ?? 100,
      position_y: posY ?? 80,
      config: null,
      created_at: new Date().toISOString(),
    };
    const prevMembers = get().teamMembers;
    set({ teamMembers: [...prevMembers, optimistic] });

    try {
      const realMember = await addTeamMember(teamId, personaId, role, posX, posY);
      // Replace temp with real member (use fresh state to avoid overwriting concurrent changes)
      set({ teamMembers: get().teamMembers.map((m) => (m.id === tempId ? realMember : m)) });
      return realMember;
    } catch {
      // Rollback
      set({ teamMembers: get().teamMembers.filter((m) => m.id !== tempId) });
      useToastStore.getState().addToast('Failed to add team member', 'error');
      return null;
    }
  },

  removeTeamMember: async (memberId) => {
    const teamId = get().selectedTeamId;
    if (!teamId) return;

    // Optimistic: remove the member and any connections referencing it
    const prevMembers = get().teamMembers;
    const prevConnections = get().teamConnections;
    set({
      teamMembers: prevMembers.filter((m) => m.id !== memberId),
      teamConnections: prevConnections.filter(
        (c) => c.source_member_id !== memberId && c.target_member_id !== memberId,
      ),
    });

    try {
      await removeTeamMember(memberId);
    } catch {
      // Rollback
      set({ teamMembers: prevMembers, teamConnections: prevConnections });
      useToastStore.getState().addToast('Failed to remove team member', 'error');
    }
  },

  createTeamConnection: async (sourceMemberId, targetMemberId, connectionType, condition, label) => {
    const teamId = get().selectedTeamId;
    if (!teamId) return null;

    // Optimistic: insert a temporary connection immediately
    const tempId = `temp-conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: PersonaTeamConnection = {
      id: tempId,
      team_id: teamId,
      source_member_id: sourceMemberId,
      target_member_id: targetMemberId,
      connection_type: connectionType || 'sequential',
      condition: condition ?? null,
      label: label ?? null,
      created_at: new Date().toISOString(),
    };
    const prevConnections = get().teamConnections;
    set({ teamConnections: [...prevConnections, optimistic] });

    try {
      const realConn = await createTeamConnection(teamId, sourceMemberId, targetMemberId, connectionType, condition, label);
      set({ teamConnections: get().teamConnections.map((c) => (c.id === tempId ? realConn : c)) });
      return realConn;
    } catch {
      // Rollback
      set({ teamConnections: get().teamConnections.filter((c) => c.id !== tempId) });
      useToastStore.getState().addToast('Failed to create team connection', 'error');
      return null;
    }
  },

  deleteTeamConnection: async (connectionId) => {
    // Optimistic: remove immediately
    const prevConnections = get().teamConnections;
    set({ teamConnections: prevConnections.filter((c) => c.id !== connectionId) });

    try {
      await deleteTeamConnection(connectionId);
    } catch {
      // Rollback
      set({ teamConnections: prevConnections });
      useToastStore.getState().addToast('Failed to delete team connection', 'error');
    }
  },

  updateTeamConnection: async (connectionId, connectionType) => {
    // Optimistic: update type immediately
    const prevConnections = get().teamConnections;
    set({
      teamConnections: prevConnections.map((c) =>
        c.id === connectionId ? { ...c, connection_type: connectionType } : c,
      ),
    });

    try {
      await updateTeamConnection(connectionId, connectionType);
    } catch {
      // Rollback
      set({ teamConnections: prevConnections });
      useToastStore.getState().addToast('Failed to update team connection', 'error');
    }
  },

  setMemoryFilters: (category, search) => {
    set({ memoryFilterCategory: category, memoryFilterSearch: search });
  },

  fetchTeamMemories: async (teamId, category, search) => {
    set({ memoryFilterCategory: category, memoryFilterSearch: search });
    try {
      const [memories, total, stats] = await Promise.all([
        listTeamMemories(teamId, undefined, category, search, 100),
        getTeamMemoryCount(teamId, undefined, category),
        getTeamMemoryStats(teamId, category, search),
      ]);
      set({ teamMemories: memories, teamMemoriesTotal: total, teamMemoryStats: stats });
    } catch {
      useToastStore.getState().addToast('Failed to load team memories', 'error');
    }
  },

  loadMoreTeamMemories: async (teamId, category, search) => {
    try {
      const offset = get().teamMemories.length;
      const more = await listTeamMemories(teamId, undefined, category, search, 100, offset);
      set((state) => ({ teamMemories: [...state.teamMemories, ...more] }));
    } catch {
      useToastStore.getState().addToast('Failed to load more memories', 'error');
    }
  },

  createTeamMemory: async (input) => {
    try {
      const memory = await createTeamMemory(input);
      // Refresh the list preserving active filters
      const { selectedTeamId: teamId, memoryFilterCategory, memoryFilterSearch } = get();
      if (teamId) get().fetchTeamMemories(teamId, memoryFilterCategory, memoryFilterSearch);
      return memory;
    } catch {
      useToastStore.getState().addToast('Failed to create team memory', 'error');
      return null;
    }
  },

  deleteTeamMemory: async (id) => {
    const prev = get().teamMemories;
    const prevTotal = get().teamMemoriesTotal;
    set((state) => ({
      teamMemories: state.teamMemories.filter((m) => m.id !== id),
      teamMemoriesTotal: Math.max(0, state.teamMemoriesTotal - 1),
    }));
    try {
      await deleteTeamMemory(id);
    } catch {
      set({ teamMemories: prev, teamMemoriesTotal: prevTotal });
      useToastStore.getState().addToast('Failed to delete team memory', 'error');
    }
  },

  batchDeleteTeamMemories: async (ids) => {
    const prev = get().teamMemories;
    const prevTotal = get().teamMemoriesTotal;
    set((state) => ({
      teamMemories: state.teamMemories.filter((m) => !ids.includes(m.id)),
      teamMemoriesTotal: Math.max(0, state.teamMemoriesTotal - ids.length),
    }));
    try {
      await batchDeleteTeamMemories(ids);
    } catch {
      set({ teamMemories: prev, teamMemoriesTotal: prevTotal });
      useToastStore.getState().addToast('Failed to delete team memories', 'error');
    }
  },

  updateTeamMemoryImportance: async (id, importance) => {
    const prev = get().teamMemories;
    set({
      teamMemories: prev.map((m) => (m.id === id ? { ...m, importance } : m)),
    });
    try {
      await updateTeamMemoryImportance(id, importance);
    } catch {
      set({ teamMemories: prev });
      useToastStore.getState().addToast('Failed to update memory importance', 'error');
    }
  },

  updateTeamMemory: async (id, title, content, category, importance) => {
    const prev = get().teamMemories;
    try {
      const updated = await updateTeamMemory(id, title, content, category, importance);
      set({
        teamMemories: prev.map((m) => (m.id === id ? updated : m)),
      });
    } catch {
      useToastStore.getState().addToast('Failed to update memory', 'error');
    }
  },
});
