import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { PersonaTeam } from "@/lib/bindings/PersonaTeam";
import type { PersonaTeamMember } from "@/lib/bindings/PersonaTeamMember";
import type { PersonaTeamConnection } from "@/lib/bindings/PersonaTeamConnection";
import * as api from "@/api/tauriApi";

export interface TeamSlice {
  // State
  teams: PersonaTeam[];
  selectedTeamId: string | null;
  teamMembers: PersonaTeamMember[];
  teamConnections: PersonaTeamConnection[];

  // Actions
  fetchTeams: () => Promise<void>;
  selectTeam: (teamId: string | null) => void;
  fetchTeamDetails: (teamId: string) => Promise<void>;
  createTeam: (data: { name: string; description?: string; icon?: string; color?: string }) => Promise<PersonaTeam | null>;
  deleteTeam: (teamId: string) => Promise<void>;
  addTeamMember: (personaId: string, role?: string, posX?: number, posY?: number) => Promise<PersonaTeamMember | null>;
  removeTeamMember: (memberId: string) => Promise<void>;
  createTeamConnection: (sourceMemberId: string, targetMemberId: string, connectionType?: string, condition?: string, label?: string) => Promise<PersonaTeamConnection | null>;
  deleteTeamConnection: (connectionId: string) => Promise<void>;
  updateTeamConnection: (connectionId: string, connectionType: string) => Promise<void>;
}

export const createTeamSlice: StateCreator<PersonaStore, [], [], TeamSlice> = (set, get) => ({
  teams: [],
  selectedTeamId: null,
  teamMembers: [],
  teamConnections: [],

  fetchTeams: async () => {
    try {
      const teams = await api.listTeams();
      set({ teams });
    } catch {
      // Silent fail
    }
  },

  selectTeam: (teamId) => {
    set({ selectedTeamId: teamId, teamMembers: [], teamConnections: [] });
    if (teamId) get().fetchTeamDetails(teamId);
  },

  fetchTeamDetails: async (teamId) => {
    try {
      const [members, connections] = await Promise.all([
        api.listTeamMembers(teamId),
        api.listTeamConnections(teamId),
      ]);
      set({ teamMembers: members, teamConnections: connections });
    } catch {
      // Silent fail
    }
  },

  createTeam: async (data) => {
    try {
      const team = await api.createTeam({
        name: data.name,
        project_id: null,
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
      return null;
    }
  },

  deleteTeam: async (teamId) => {
    try {
      await api.deleteTeam(teamId);
      if (get().selectedTeamId === teamId) set({ selectedTeamId: null, teamMembers: [], teamConnections: [] });
      await get().fetchTeams();
    } catch {
      // Silent fail
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
      const realMember = await api.addTeamMember(teamId, personaId, role, posX, posY);
      // Replace temp with real member (use fresh state to avoid overwriting concurrent changes)
      set({ teamMembers: get().teamMembers.map((m) => (m.id === tempId ? realMember : m)) });
      return realMember;
    } catch {
      // Rollback
      set({ teamMembers: get().teamMembers.filter((m) => m.id !== tempId) });
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
      await api.removeTeamMember(memberId);
    } catch {
      // Rollback
      set({ teamMembers: prevMembers, teamConnections: prevConnections });
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
      const realConn = await api.createTeamConnection(teamId, sourceMemberId, targetMemberId, connectionType, condition, label);
      set({ teamConnections: get().teamConnections.map((c) => (c.id === tempId ? realConn : c)) });
      return realConn;
    } catch {
      // Rollback
      set({ teamConnections: get().teamConnections.filter((c) => c.id !== tempId) });
      return null;
    }
  },

  deleteTeamConnection: async (connectionId) => {
    // Optimistic: remove immediately
    const prevConnections = get().teamConnections;
    set({ teamConnections: prevConnections.filter((c) => c.id !== connectionId) });

    try {
      await api.deleteTeamConnection(connectionId);
    } catch {
      // Rollback
      set({ teamConnections: prevConnections });
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
      await api.updateTeamConnection(connectionId, connectionType);
    } catch {
      // Rollback
      set({ teamConnections: prevConnections });
    }
  },
});
