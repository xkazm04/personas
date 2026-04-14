import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

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

export const createSetupSlice: StateCreator<SystemStore, [], [], SetupSlice> = (set) => ({
  setupRole: null,
  setupTool: null,
  setupGoal: null,
  setupCompleted: false,
  setSetupRole: (role) => set((state) => ({
    setupRole: role,
    // Clear downstream selections when role changes — tools differ per role
    ...(state.setupRole !== role ? { setupTool: null, setupGoal: null } : {}),
  })),
  setSetupTool: (tool) => set({ setupTool: tool }),
  setSetupGoal: (goal) => set({ setupGoal: goal }),
  dismissSetup: () => set({ setupCompleted: true }),
});
