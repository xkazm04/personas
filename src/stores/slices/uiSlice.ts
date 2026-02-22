import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { SidebarSection, EditorTab, TemplateTab, SettingsTab } from "@/lib/types/types";

export interface UiSlice {
  // State
  sidebarSection: SidebarSection;
  credentialView: "credentials" | "from-template" | "add-new";
  templateTab: TemplateTab;
  editorTab: EditorTab;
  settingsTab: SettingsTab;
  rerunInputData: string | null;
  isLoading: boolean;
  error: string | null;
  n8nTransformActive: boolean;
  templateAdoptActive: boolean;
  showDesignNudge: boolean;
  showCloudNudge: boolean;

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setCredentialView: (view: "credentials" | "from-template" | "add-new") => void;
  setTemplateTab: (tab: TemplateTab) => void;
  setEditorTab: (tab: EditorTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setRerunInputData: (data: string | null) => void;
  setError: (error: string | null) => void;
  setN8nTransformActive: (active: boolean) => void;
  setTemplateAdoptActive: (active: boolean) => void;
  setShowDesignNudge: (show: boolean) => void;
  setShowCloudNudge: (show: boolean) => void;
}

export const createUiSlice: StateCreator<PersonaStore, [], [], UiSlice> = (set) => ({
  sidebarSection: "overview" as SidebarSection,
  credentialView: "credentials",
  templateTab: "builtin" as TemplateTab,
  editorTab: "prompt" as EditorTab,
  settingsTab: "account" as SettingsTab,
  rerunInputData: null,
  isLoading: false,
  error: null,
  n8nTransformActive: false,
  templateAdoptActive: false,
  showDesignNudge: false,
  showCloudNudge: false,

  setSidebarSection: (section) => set({ sidebarSection: section }),
  setCredentialView: (view) => set({ credentialView: view }),
  setTemplateTab: (tab) => set({ templateTab: tab }),
  setEditorTab: (tab) => set({ editorTab: tab }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setRerunInputData: (data) => set({ rerunInputData: data }),
  setError: (error) => set({ error }),
  setN8nTransformActive: (active) => set({ n8nTransformActive: active }),
  setTemplateAdoptActive: (active) => set({ templateAdoptActive: active }),
  setShowDesignNudge: (show) => set({ showDesignNudge: show }),
  setShowCloudNudge: (show) => set({ showCloudNudge: show }),
});
