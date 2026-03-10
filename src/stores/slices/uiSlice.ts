import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { SidebarSection, HomeTab, EditorTab, TemplateTab, CloudTab, SettingsTab } from "@/lib/types/types";
import type { AdoptWizardStep } from "@/features/templates/sub_generated/adoption/useAdoptReducer";

/** Snapshot of adoption wizard state saved when the user closes mid-adoption. */
export interface AdoptionDraft {
  reviewId: string;
  templateName: string;
  step: AdoptWizardStep;
  connectorSwaps: Record<string, string>;
  connectorCredentialMap: Record<string, string>;
  variableValues: Record<string, string>;
  savedAt: number;
<<<<<<< HEAD
  // Extended fields — persisted for full session restore
  triggerConfigs?: Record<number, Record<string, string>>;
  requireApproval?: boolean;
  autoApproveSeverity?: string;
  reviewTimeout?: string;
  memoryEnabled?: boolean;
  memoryScope?: string;
  userAnswers?: Record<string, string>;
  /** Non-null when the user closed while a background transform was running. */
  backgroundAdoptId?: string | null;
  /** Persisted entity selections (Phase C — Area #13) */
  selectedUseCaseIds?: string[];
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
}

export interface UiSlice {
  // State
  sidebarSection: SidebarSection;
  homeTab: HomeTab;
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
  rebuildActive: boolean;
  templateTestActive: boolean;
  connectorTestActive: boolean;
  templateGalleryTotal: number;
  adoptionDraft: AdoptionDraft | null;

  // Actions
  setSidebarSection: (section: SidebarSection) => void;
  setHomeTab: (tab: HomeTab) => void;
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
  setRebuildActive: (active: boolean) => void;
  setTemplateTestActive: (active: boolean) => void;
  setConnectorTestActive: (active: boolean) => void;
  setTemplateGalleryTotal: (total: number) => void;
  setAdoptionDraft: (draft: AdoptionDraft | null) => void;
}

export const createUiSlice: StateCreator<PersonaStore, [], [], UiSlice> = (set) => ({
  sidebarSection: "home" as SidebarSection,
  homeTab: "welcome" as HomeTab,
  templateTab: "generated" as TemplateTab,
  editorTab: "use-cases" as EditorTab,
  cloudTab: "unified" as CloudTab,
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
  rebuildActive: false,
  templateTestActive: false,
  connectorTestActive: false,
  templateGalleryTotal: 0,
  adoptionDraft: null,

  setSidebarSection: (section) => set({ sidebarSection: section }),
  setHomeTab: (tab) => set({ homeTab: tab }),
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
  setRebuildActive: (active) => set({ rebuildActive: active }),
  setTemplateTestActive: (active) => set({ templateTestActive: active }),
  setConnectorTestActive: (active) => set({ connectorTestActive: active }),
  setTemplateGalleryTotal: (total) => set({ templateGalleryTotal: total }),
  setAdoptionDraft: (draft) => set({ adoptionDraft: draft }),
});
