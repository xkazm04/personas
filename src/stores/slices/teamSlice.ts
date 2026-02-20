import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { PersonaTeamConnection } from "@/lib/bindings/PersonaTeamConnection";
import * as api from "@/api/tauriApi";

export interface TeamSlice {
  // State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teams: any[];
  selectedTeamId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamMembers: any[];
  teamConnections: PersonaTeamConnection[];

  // Actions
  fetchTeams: () => Promise<void>;
  selectTeam: (teamId: string | null) => void;
  fetchTeamDetails: (teamId: string) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTeam: (data: { name: string; description?: string; icon?: string; color?: string }) => Promise<any>;
  deleteTeam: (teamId: string) => Promise<void>;
  addTeamMember: (personaId: string, role?: string, posX?: number, posY?: number) => Promise<void>;
  removeTeamMember: (memberId: string) => Promise<void>;
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
    if (!teamId) return;
    try {
      await api.addTeamMember(teamId, personaId, role, posX, posY);
      await get().fetchTeamDetails(teamId);
    } catch {
      // Silent fail
    }
  },

  removeTeamMember: async (memberId) => {
    const teamId = get().selectedTeamId;
    if (!teamId) return;
    try {
      await api.removeTeamMember(memberId);
      await get().fetchTeamDetails(teamId);
    } catch {
      // Silent fail
    }
  },
});
