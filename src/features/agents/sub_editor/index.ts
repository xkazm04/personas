// Barrel exports for sub_editor
export { default as PersonaEditor } from './components/PersonaEditor';
export { EditorBody } from './components/EditorBody';
export { EditorTabBar } from './components/EditorTabBar';
export { PersonaEditorHeader } from './components/PersonaEditorHeader';
export { UnsavedChangesBanner, CloudNudgeBanner } from './components/EditorBanners';
export { EditorDirtyProvider, useEditorDirty, useEditorDirtyState, useEditorHistory, TabSaveError, type UndoEntry } from './libs/EditorDocument';
export { type PersonaDraft, buildDraft, draftChanged, SETTINGS_KEYS, MODEL_KEYS } from './libs/PersonaDraft';
export { useEditorSave } from './libs/useEditorSave';
export { useEffectivePersona } from './libs/useEffectivePersona';
export { useTabSection, type TabSaveMode, type TabSectionConfig, type TabSectionHandle } from './libs/useTabSection';
export { TAB_DIRTY_DEPENDENCIES, TAB_LABELS, tabIdsToLabels, isTabDirty } from './libs/editorTabConstants';
