import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from "@/stores/agentStore";
import { useTabSection } from '@/features/agents/sub_editor';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';
import { newSectionId } from '@/lib/personas/promptMigration';
import { SectionEditor } from '@/features/shared/components/editors/draft-editor/SectionEditor';
import { PromptSectionSidebar } from './PromptSectionSidebar';
import { CustomSectionsPanel } from './CustomSectionsPanel';
import type { SubTab } from './PromptSectionSidebar';
import { STANDARD_TABS, promptChanged } from '../libs/promptEditorHelpers';
import { useStructuredPromptSync } from '../libs/useStructuredPromptSync';
import { createLogger } from "@/lib/log";

const logger = createLogger("persona-prompt-editor");

import type { ModelProfile } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';

export function PersonaPromptEditor() {
  const { t, tx } = useTranslation();
  const applyPersonaOp = useAgentStore((state) => state.applyPersonaOp);
  const [activeTab, setActiveTab] = useState<SubTab>('instructions');

  const {
    selectedPersona,
    sp, setSp,
    baseline,
    markSaved,
    personaIdRef,
    spRef,
    baselineRef,
  } = useStructuredPromptSync();

  const isAnthropic = useMemo(() => {
    if (!selectedPersona?.model_profile) return true;
    const mp = parseJsonSafe<ModelProfile | null>(selectedPersona.model_profile, null);
    return !mp?.provider || mp.provider === 'anthropic';
  }, [selectedPersona?.model_profile]);

  const visibleTabs = useMemo(() => {
    return STANDARD_TABS.filter((tab) => tab.key !== 'webSearch' || isAnthropic);
  }, [isAnthropic]);

  const [showSaved, setShowSaved] = useState(false);
  const [selectedCustomIndex, setSelectedCustomIndex] = useState(0);
  // After an Add, we want to select the newly-added section by id (not by
  // length, which is racy under concurrent clicks). Resolved in an effect
  // once the new section lands in state.
  const pendingSelectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const pendingId = pendingSelectIdRef.current;
    if (!pendingId) return;
    const idx = sp.customSections.findIndex((s) => s.id === pendingId);
    if (idx >= 0) {
      setSelectedCustomIndex(idx);
      pendingSelectIdRef.current = null;
    }
  }, [sp.customSections]);

  const promptDirty = useMemo(() => promptChanged(sp, baseline), [sp, baseline]);

  useEffect(() => {
    if (activeTab === 'webSearch' && !isAnthropic) setActiveTab('instructions');
  }, [isAnthropic, activeTab]);

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
      markSaved(current);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (error) { logger.error('Failed to save structured prompt', { error }); }
  }, [applyPersonaOp, personaIdRef, spRef, baselineRef, markSaved]);

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
  }, [setSp]);

  const addCustomSection = useCallback(() => {
    // Generate id BEFORE state update so the "select newly-added section"
    // step can resolve by id after the functional setSp commits — avoids
    // the setState-inside-setState anti-pattern and the rapid-click race
    // where both handlers read a stale customSections.length.
    const newId = newSectionId();
    setSp((prev) => ({
      ...prev,
      customSections: [
        ...prev.customSections,
        { id: newId, title: t.agents.prompt_editor.new_section, content: '' },
      ],
    }));
    // The new section is always appended, so its index equals the length
    // that WILL be produced. We read the ref-backed latest state after the
    // updater below via an effect keyed on customSections.length.
    pendingSelectIdRef.current = newId;
    setActiveTab('custom');
  }, [setSp, t.agents.prompt_editor.new_section]);

  const updateCustomSection = useCallback((index: number, field: 'title' | 'content', value: string) => {
    setSp((prev) => ({
      ...prev,
      customSections: prev.customSections.map((s, i) => i === index ? { ...s, [field]: value } : s),
    }));
  }, [setSp]);

  const removeCustomSection = useCallback((index: number) => {
    setSp((prev) => {
      const newSections = prev.customSections.filter((_, i) => i !== index);
      setSelectedCustomIndex((prevIdx) =>
        prevIdx >= newSections.length ? Math.max(0, newSections.length - 1) : prevIdx,
      );
      return { ...prev, customSections: newSections };
    });
  }, [setSp]);

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
      <div className="flex items-center justify-center py-8 text-foreground">
        {t.agents.prompt_editor.no_persona}
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
            label={STANDARD_TABS.find((st) => st.key === activeTab)?.label ?? activeTab}
            placeholder={tx(t.agents.prompt_editor.enter_content, { section: STANDARD_TABS.find((st) => st.key === activeTab)?.label.toLowerCase() ?? activeTab })}
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
