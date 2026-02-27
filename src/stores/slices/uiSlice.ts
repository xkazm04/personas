import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { SidebarSection, EditorTab, TemplateTab, CloudTab, SettingsTab } from "@/lib/types/types";

export interface UiSlice {
  // State
  sidebarSection: SidebarSection;
  credentialView: "credentials" | "from-template" | "add-new" | "add-api-tool" | "add-mcp" | "add-custom" | "add-database";
  templateTab: TemplateTab;
  editorTab: EditorTab;
  cloudTab: CloudTab;
  settingsTab: SettingsTab;
  rerunInputData: string | null;
  isLoading: boolean;
  error: string | null;
  n8nTransformActive: boolean;
  templateAdoptActive: boolean;
  showDesignNudge: boolean;
  showCloudNudge: boolean;
  isCreatingPersona: boolean;
  autoStartDesignInstruction: string | null;

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setCredentialView: (view: "credentials" | "from-template" | "add-new" | "add-api-tool" | "add-mcp" | "add-custom" | "add-database") => void;
  setTemplateTab: (tab: TemplateTab) => void;
  setEditorTab: (tab: EditorTab) => void;
  setCloudTab: (tab: CloudTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setRerunInputData: (data: string | null) => void;
  setError: (error: string | null) => void;
  setN8nTransformActive: (active: boolean) => void;
  setTemplateAdoptActive: (active: boolean) => void;
  setShowDesignNudge: (show: boolean) => void;
  setShowCloudNudge: (show: boolean) => void;
  setIsCreatingPersona: (creating: boolean) => void;
  setAutoStartDesignInstruction: (instruction: string | null) => void;
}

export const createUiSlice: StateCreator<PersonaStore, [], [], UiSlice> = (set) => ({
  sidebarSection: "overview" as SidebarSection,
  credentialView: "credentials",
  templateTab: "builtin" as TemplateTab,
  editorTab: "use-cases" as EditorTab,
  cloudTab: "cloud" as CloudTab,
  settingsTab: "account" as SettingsTab,
  rerunInputData: null,
  isLoading: false,
  error: null,
  n8nTransformActive: false,
  templateAdoptActive: false,
  showDesignNudge: false,
  showCloudNudge: false,
  isCreatingPersona: false,
  autoStartDesignInstruction: null,

  setSidebarSection: (section) => set({ sidebarSection: section }),
  setCredentialView: (view) => set({ credentialView: view }),
  setTemplateTab: (tab) => set({ templateTab: tab }),
  setEditorTab: (tab) => set({ editorTab: tab }),
  setCloudTab: (tab) => set({ cloudTab: tab }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setRerunInputData: (data) => set({ rerunInputData: data }),
  setError: (error) => set({ error }),
  setN8nTransformActive: (active) => set({ n8nTransformActive: active }),
  setTemplateAdoptActive: (active) => set({ templateAdoptActive: active }),
  setShowDesignNudge: (show) => set({ showDesignNudge: show }),
  setShowCloudNudge: (show) => set({ showCloudNudge: show }),
  setIsCreatingPersona: (creating) => set({ isCreatingPersona: creating }),
  setAutoStartDesignInstruction: (instruction) => set({ autoStartDesignInstruction: instruction }),
});
