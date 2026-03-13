import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { User, BookOpen, Wrench, Code, AlertTriangle, Layers, Globe } from 'lucide-react';
import { useTabSection } from '@/features/agents/sub_editor/useTabSection';
import {
  migratePromptToStructured,
  parseStructuredPrompt,
  createEmptyStructuredPrompt,
} from '@/lib/personas/promptMigration';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';
import { SectionEditor } from '@/features/shared/components/editors/draft-editor/SectionEditor';
import { PromptSectionSidebar } from './PromptSectionSidebar';
import { CustomSectionsPanel } from './CustomSectionsPanel';
import type { SubTab, SidebarEntry } from './PromptSectionSidebar';

import type { ModelProfile } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';

const STANDARD_TABS: SidebarEntry[] = [
  { key: 'identity', label: 'Identity', Icon: User },
  { key: 'instructions', label: 'Instructions', Icon: BookOpen },
  { key: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench },
  { key: 'examples', label: 'Examples', Icon: Code },
  { key: 'errorHandling', label: 'Error Handling', Icon: AlertTriangle },
  { key: 'webSearch', label: 'Web Search', Icon: Globe },
  { key: 'custom', label: 'Custom', Icon: Layers },
];

/** Compare two StructuredPrompt objects for equality (serialized). */
function promptChanged(current: StructuredPrompt, baseline: StructuredPrompt): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

export function PersonaPromptEditor() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const applyPersonaOp = useAgentStore((state) => state.applyPersonaOp);
  const [activeTab, setActiveTab] = useState<SubTab>('instructions');

  const isAnthropic = useMemo(() => {
    if (!selectedPersona?.model_profile) return true;
    const mp = parseJsonSafe<ModelProfile | null>(selectedPersona.model_profile, null);
    return !mp?.provider || mp.provider === 'anthropic';
  }, [selectedPersona?.model_profile]);

  const visibleTabs = useMemo(() => {
    return STANDARD_TABS.filter((tab) => tab.key !== 'webSearch' || isAnthropic);
  }, [isAnthropic]);

  const [sp, setSp] = useState<StructuredPrompt>(createEmptyStructuredPrompt());
  const [baseline, setBaseline] = useState<StructuredPrompt>(sp);
  const [showSaved, setShowSaved] = useState(false);
  const [selectedCustomIndex, setSelectedCustomIndex] = useState(0);

  // Derive dirty from baseline comparison -- single source of truth
  const promptDirty = useMemo(() => promptChanged(sp, baseline), [sp, baseline]);

  useEffect(() => {
    if (activeTab === 'webSearch' && !isAnthropic) setActiveTab('instructions');
  }, [isAnthropic, activeTab]);

  const personaIdRef = useRef<string | null>(null);
  const spRef = useRef(sp);
  spRef.current = sp;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const lastLoadedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedPersona) {
      const empty = createEmptyStructuredPrompt();
      setSp(empty);
      setBaseline(empty);
      personaIdRef.current = null;
      lastLoadedPromptRef.current = null;
      return;
    }
    const currentPromptRaw = selectedPersona.structured_prompt ?? null;
    const isNewPersona = personaIdRef.current !== selectedPersona.id;
    const isExternalUpdate =
      !isNewPersona &&
      currentPromptRaw !== lastLoadedPromptRef.current &&
      currentPromptRaw !== JSON.stringify(baselineRef.current);
    if (!isNewPersona && !isExternalUpdate) return;
    personaIdRef.current = selectedPersona.id;
    lastLoadedPromptRef.current = currentPromptRaw;
    const parsed = parseStructuredPrompt(currentPromptRaw);
    if (parsed) {
      setSp(parsed);
      setBaseline(parsed);
      return;
    }
    if (selectedPersona.system_prompt) {
      const migrated = migratePromptToStructured(selectedPersona.system_prompt);
      setSp(migrated);
      setBaseline(migrated);
      return;
    }
    const empty = createEmptyStructuredPrompt();
    setSp(empty);
    setBaseline(empty);
  }, [selectedPersona]);

  const doSave = useCallback(async () => {
    const pid = personaIdRef.current;
    if (!pid) return;
    const current = spRef.current;
    const jsonStr = JSON.stringify(current);
    if (jsonStr === JSON.stringify(baselineRef.current)) return;
    try {
      await applyPersonaOp(pid, {
        kind: 'UpdatePrompt',
        structured_prompt: jsonStr,
        system_prompt: current.instructions || '',
      });
      setBaseline(current);
      lastLoadedPromptRef.current = jsonStr;
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (error) { console.error('Failed to save structured prompt:', error); }
  }, [applyPersonaOp]);

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
