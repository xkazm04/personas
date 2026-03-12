import type { StateCreator } from 'zustand';
import type { PersonaStore } from '../../storeTypes';

export interface SetupSlice {
  setupRole: string | null;
  setupTool: string | null;
  setupGoal: string | null;
  setupCompleted: boolean;
  setSetupRole: (role: string) => void;
  setSetupTool: (tool: string) => void;
  setSetupGoal: (goal: string) => void;
  dismissSetup: () => void;
}

export const createSetupSlice: StateCreator<PersonaStore, [], [], SetupSlice> = (set) => ({
  setupRole: null,
  setupTool: null,
  setupGoal: null,
  setupCompleted: false,
  setSetupRole: (role) => set({ setupRole: role }),
  setSetupTool: (tool) => set({ setupTool: tool }),
  setSetupGoal: (goal) => set({ setupGoal: goal }),
  dismissSetup: () => set({ setupCompleted: true }),
});
