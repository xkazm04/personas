import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { User, BookOpen, Wrench, Code, AlertTriangle, Layers, Globe } from 'lucide-react';
import { useTabSection } from '@/features/agents/sub_editor/useTabSection';
import {
  migratePromptToStructured,
  parseStructuredPrompt,
  createEmptyStructuredPrompt,
} from '@/lib/personas/promptMigration';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';
import { SectionEditor } from '@/features/shared/components/draft-editor/SectionEditor';
import { PromptSectionSidebar } from './PromptSectionSidebar';
import { CustomSectionsPanel } from './CustomSectionsPanel';
import type { SubTab, SidebarEntry } from './PromptSectionSidebar';

import type { ModelProfile } from '@/lib/types/frontendTypes';

const STANDARD_TABS: SidebarEntry[] = [
  { key: 'identity', label: 'Identity', Icon: User },
  { key: 'instructions', label: 'Instructions', Icon: BookOpen },
  { key: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench },
  { key: 'examples', label: 'Examples', Icon: Code },
  { key: 'errorHandling', label: 'Error Handling', Icon: AlertTriangle },
  { key: 'webSearch', label: 'Web Search', Icon: Globe },
  { key: 'custom', label: 'Custom', Icon: Layers },
];

export function PersonaPromptEditor() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const applyPersonaOp = usePersonaStore((state) => state.applyPersonaOp);
  const [activeTab, setActiveTab] = useState<SubTab>('instructions');

  const isAnthropic = useMemo(() => {
    if (!selectedPersona?.model_profile) return true;
    try {
      const mp: ModelProfile = JSON.parse(selectedPersona.model_profile);
      return !mp.provider || mp.provider === 'anthropic';
    } catch { return true; }
  }, [selectedPersona?.model_profile]);

  const visibleTabs = useMemo(() => {
    return STANDARD_TABS.filter((tab) => tab.key !== 'webSearch' || isAnthropic);
  }, [isAnthropic]);

  const [sp, setSp] = useState<StructuredPrompt>(createEmptyStructuredPrompt());
  const [showSaved, setShowSaved] = useState(false);
  const [selectedCustomIndex, setSelectedCustomIndex] = useState(0);

  useEffect(() => {
    if (activeTab === 'webSearch' && !isAnthropic) setActiveTab('instructions');
  }, [isAnthropic, activeTab]);

  const personaIdRef = useRef<string | null>(null);
  const spRef = useRef(sp);
  spRef.current = sp;
  const lastSavedJsonRef = useRef<string | null>(null);
  const lastLoadedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedPersona) {
      setSp(createEmptyStructuredPrompt());
      personaIdRef.current = null;
      lastLoadedPromptRef.current = null;
      lastSavedJsonRef.current = null;
      return;
    }
    const currentPromptRaw = selectedPersona.structured_prompt ?? null;
    const isNewPersona = personaIdRef.current !== selectedPersona.id;
    const isExternalUpdate =
      !isNewPersona &&
      currentPromptRaw !== lastLoadedPromptRef.current &&
      currentPromptRaw !== lastSavedJsonRef.current;
    if (!isNewPersona && !isExternalUpdate) return;
    personaIdRef.current = selectedPersona.id;
    lastLoadedPromptRef.current = currentPromptRaw;
    const parsed = parseStructuredPrompt(currentPromptRaw);
    if (parsed) { setSp(parsed); lastSavedJsonRef.current = JSON.stringify(parsed); return; }
    if (selectedPersona.system_prompt) {
      const migrated = migratePromptToStructured(selectedPersona.system_prompt);
      setSp(migrated); lastSavedJsonRef.current = JSON.stringify(migrated); return;
    }
    const empty = createEmptyStructuredPrompt();
    setSp(empty); lastSavedJsonRef.current = JSON.stringify(empty);
  }, [selectedPersona]);

  const doSave = useCallback(async () => {
    const pid = personaIdRef.current;
    if (!pid) return;
    const jsonStr = JSON.stringify(spRef.current);
    if (jsonStr === lastSavedJsonRef.current) return;
    try {
      await applyPersonaOp(pid, {
        kind: 'UpdatePrompt',
        structured_prompt: jsonStr,
        system_prompt: spRef.current.instructions || '',
      });
      lastSavedJsonRef.current = jsonStr;
      lastLoadedPromptRef.current = jsonStr;
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (error) { console.error('Failed to save structured prompt:', error); }
  }, [applyPersonaOp]);

  const promptDirty = useMemo(
    () => lastSavedJsonRef.current !== null && JSON.stringify(sp) !== lastSavedJsonRef.current,
    [sp],
  );
  const { isSaving } = useTabSection({
    tab: 'prompt',
    isDirty: promptDirty,
    save: doSave,
    mode: 'debounced',
    delay: 1000,
    deps: [sp],
  });

  const updateField = useCallback((field: keyof Omit<StructuredPrompt, 'customSections'>, value: string) => {
    setSp((prev) => ({ ...prev, [field]: value }));
  }, []);

  const addCustomSection = useCallback(() => {
    setSp((prev) => {
      setSelectedCustomIndex(prev.customSections.length);
      return { ...prev, customSections: [...prev.customSections, { title: 'New Section', content: '' }] };
    });
    setActiveTab('custom');
  }, []);

  const updateCustomSection = useCallback((index: number, field: 'title' | 'content', value: string) => {
    setSp((prev) => ({
      ...prev,
      customSections: prev.customSections.map((s, i) => i === index ? { ...s, [field]: value } : s),
    }));
  }, []);

  const removeCustomSection = useCallback((index: number) => {
    setSp((prev) => {
      const newSections = prev.customSections.filter((_, i) => i !== index);
      setSelectedCustomIndex((prevIdx) =>
        prevIdx >= newSections.length ? Math.max(0, newSections.length - 1) : prevIdx,
      );
      return { ...prev, customSections: newSections };
    });
  }, []);

  const sectionFilled = useMemo(() => ({
    identity: !!sp.identity?.trim(),
    instructions: !!sp.instructions?.trim(),
    toolGuidance: !!sp.toolGuidance?.trim(),
    examples: !!sp.examples?.trim(),
    errorHandling: !!sp.errorHandling?.trim(),
    webSearch: !!sp.webSearch?.trim(),
    custom: sp.customSections.length > 0,
  }), [sp]);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const isStandard = (tab: SubTab): tab is keyof Omit<StructuredPrompt, 'customSections'> =>
    tab !== 'custom';

  return (
    <div className="flex h-full min-h-0 gap-3">
      <PromptSectionSidebar
        visibleTabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sectionFilled={sectionFilled}
        showSaved={showSaved}
        isSaving={isSaving}
      />
      <div className="flex-1 min-w-0 min-h-0">
        {isStandard(activeTab) && (
          <SectionEditor
            value={sp[activeTab]}
            onChange={(v) => updateField(activeTab, v)}
            label={STANDARD_TABS.find((t) => t.key === activeTab)?.label ?? activeTab}
            placeholder={`Enter ${STANDARD_TABS.find((t) => t.key === activeTab)?.label.toLowerCase()} content...`}
          />
        )}
        {activeTab === 'custom' && (
          <CustomSectionsPanel
            sections={sp.customSections}
            selectedIndex={selectedCustomIndex}
            onSelectIndex={setSelectedCustomIndex}
            onAdd={addCustomSection}
            onUpdate={updateCustomSection}
            onRemove={removeCustomSection}
          />
        )}
      </div>
    </div>
  );
}
