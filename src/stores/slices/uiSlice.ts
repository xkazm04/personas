import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { SidebarSection, EditorTab } from "@/lib/types/types";

export interface UiSlice {
  // State
  sidebarSection: SidebarSection;
  credentialView: "credentials" | "from-template" | "add-new";
  editorTab: EditorTab;
  rerunInputData: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setCredentialView: (view: "credentials" | "from-template" | "add-new") => void;
  setEditorTab: (tab: EditorTab) => void;
  setRerunInputData: (data: string | null) => void;
  setError: (error: string | null) => void;
}

export const createUiSlice: StateCreator<PersonaStore, [], [], UiSlice> = (set) => ({
  sidebarSection: "overview" as SidebarSection,
  credentialView: "credentials",
  editorTab: "prompt" as EditorTab,
  rerunInputData: null,
  isLoading: false,
  error: null,

  setSidebarSection: (section) => set({ sidebarSection: section }),
  setCredentialView: (view) => set({ credentialView: view }),
  setEditorTab: (tab) => set({ editorTab: tab }),
  setRerunInputData: (data) => set({ rerunInputData: data }),
  setError: (error) => set({ error }),
});
