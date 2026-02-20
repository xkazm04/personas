import type { StateCreator } from "zustand";
import type { PersonaStore, ActiveDesignSession } from "../storeTypes";
import type { DesignPhase } from "@/lib/types/designTypes";

export interface DesignSlice {
  // State
  designPhase: DesignPhase;
  activeDesignSession: ActiveDesignSession | null;

  // Actions
  setDesignPhase: (phase: DesignPhase) => void;
  setActiveDesignSession: (session: ActiveDesignSession | null) => void;
  appendDesignOutputLine: (line: string) => void;
}

export const createDesignSlice: StateCreator<PersonaStore, [], [], DesignSlice> = (set) => ({
  designPhase: "idle" as DesignPhase,
  activeDesignSession: null,

  setDesignPhase: (phase) => set({ designPhase: phase }),
  setActiveDesignSession: (session) => set({ activeDesignSession: session }),
  appendDesignOutputLine: (line) =>
    set((state) => {
      if (!state.activeDesignSession) return {};
      return {
        activeDesignSession: {
          ...state.activeDesignSession,
          outputLines: [...state.activeDesignSession.outputLines, line],
        },
      };
    }),
});
