import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDebouncedSave } from '@/hooks';
import { usePersonaStore } from '@/stores/personaStore';
import { User, BookOpen, Wrench, Code, AlertTriangle, Layers, Globe, Plus, X, Check, Save } from 'lucide-react';
import { useEditorDirty } from '@/features/agents/sub_editor/EditorDirtyContext';
import { AnimatePresence, motion } from 'framer-motion';
import {
  migratePromptToStructured,
  parseStructuredPrompt,
  createEmptyStructuredPrompt,
} from '@/lib/personas/promptMigration';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';
import { SectionEditor } from '@/features/shared/components/draft-editor/SectionEditor';

import type { ModelProfile } from '@/lib/types/frontendTypes';

type SubTab = 'identity' | 'instructions' | 'toolGuidance' | 'examples' | 'errorHandling' | 'webSearch' | 'custom';

interface SidebarEntry {
  key: SubTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

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
  const updatePersona = usePersonaStore((state) => state.updatePersona);

  const [activeTab, setActiveTab] = useState<SubTab>('instructions');

  // Detect if persona uses Anthropic provider (web search is Anthropic-only)
  const isAnthropic = useMemo(() => {
    if (!selectedPersona?.model_profile) return true; // default is Anthropic
    try {
      const mp: ModelProfile = JSON.parse(selectedPersona.model_profile);
      return !mp.provider || mp.provider === 'anthropic';
    } catch {
      return true;
    }
  }, [selectedPersona?.model_profile]);

  const visibleTabs = useMemo(() => {
    return STANDARD_TABS.filter((tab) => {
      if (tab.key === 'webSearch') return isAnthropic;
      return true;
    });
  }, [isAnthropic]);

  const [sp, setSp] = useState<StructuredPrompt>(createEmptyStructuredPrompt());
  const [showSaved, setShowSaved] = useState(false);
  const [selectedCustomIndex, setSelectedCustomIndex] = useState(0);

  // Auto-switch away from webSearch if provider changes to non-Anthropic
  useEffect(() => {
    if (activeTab === 'webSearch' && !isAnthropic) {
      setActiveTab('instructions');
    }
  }, [isAnthropic, activeTab]);

  const personaIdRef = useRef<string | null>(null);
  const spRef = useRef(sp);
  spRef.current = sp;
  const lastSavedJsonRef = useRef<string | null>(null);
  const lastLoadedPromptRef = useRef<string | null>(null);

  // Initialize structured prompt from persona data
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
    if (parsed) {
      setSp(parsed);
      lastSavedJsonRef.current = JSON.stringify(parsed);
      return;
    }

    if (selectedPersona.system_prompt) {
      const migrated = migratePromptToStructured(selectedPersona.system_prompt);
      setSp(migrated);
      lastSavedJsonRef.current = JSON.stringify(migrated);
      return;
    }

    const empty = createEmptyStructuredPrompt();
    setSp(empty);
    lastSavedJsonRef.current = JSON.stringify(empty);
  }, [selectedPersona]);

  // Debounced auto-save
  const doSave = useCallback(async () => {
    const pid = personaIdRef.current;
    if (!pid) return;

    const jsonStr = JSON.stringify(spRef.current);
    if (jsonStr === lastSavedJsonRef.current) return;

    try {
      await updatePersona(pid, {
        structured_prompt: jsonStr,
        system_prompt: spRef.current.instructions || '',
      });
      lastSavedJsonRef.current = jsonStr;
      lastLoadedPromptRef.current = jsonStr;
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save structured prompt:', error);
    }
  }, [updatePersona]);

  // Register prompt dirty state with the unified editor context
  const promptDirty = useMemo(
    () => lastSavedJsonRef.current !== null && JSON.stringify(sp) !== lastSavedJsonRef.current,
    [sp],
  );
  const unregisterDirty = useEditorDirty('prompt', promptDirty, doSave);
  useEffect(() => unregisterDirty, [unregisterDirty]);

  const isSaving = useDebouncedSave(doSave, promptDirty, [sp], 1000);

  const updateField = useCallback((field: keyof Omit<StructuredPrompt, 'customSections'>, value: string) => {
    setSp((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Custom sections management
  const addCustomSection = useCallback(() => {
    setSp((prev) => {
      const newSections = [...prev.customSections, { title: 'New Section', content: '' }];
      return { ...prev, customSections: newSections };
    });
    setSelectedCustomIndex((sp.customSections ?? []).length);
    setActiveTab('custom');
  }, [sp.customSections.length]);

  const updateCustomSection = useCallback((index: number, field: 'title' | 'content', value: string) => {
    setSp((prev) => ({
      ...prev,
      customSections: prev.customSections.map((s, i) =>
        i === index ? { ...s, [field]: value } : s
      ),
    }));
  }, []);

  const removeCustomSection = useCallback((index: number) => {
    setSp((prev) => ({
      ...prev,
      customSections: prev.customSections.filter((_, i) => i !== index),
    }));
    if (selectedCustomIndex >= (sp.customSections.length - 1)) {
      setSelectedCustomIndex(Math.max(0, sp.customSections.length - 2));
    }
  }, [selectedCustomIndex, sp.customSections.length]);

  // Build sidebar indicator state
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

  const currentCustom = sp.customSections[selectedCustomIndex];

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Left sidebar navigation */}
      <div className="w-36 flex-shrink-0 flex flex-col gap-1">
        <div className="space-y-0.5 flex-1">
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.key;
            const filled = sectionFilled[tab.key];
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                  active
                    ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                    : 'text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
                }`}
              >
                <tab.Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{tab.label}</span>
                {filled && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400/60 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Save status */}
        <div className="flex items-center gap-2 px-1 py-1 flex-shrink-0">
          <AnimatePresence>
            {showSaved && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 text-sm text-emerald-400"
              >
                <Check className="w-3 h-3" />
                Saved
              </motion.div>
            )}
          </AnimatePresence>
          {isSaving && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground/90">
              <Save className="w-3 h-3 animate-pulse" />
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 min-w-0 min-h-0">
        {/* Standard prompt fields — sidebar + SectionEditor */}
        {isStandard(activeTab) && (
          <SectionEditor
            value={sp[activeTab]}
            onChange={(v) => updateField(activeTab, v)}
            label={STANDARD_TABS.find((t) => t.key === activeTab)?.label ?? activeTab}
            placeholder={`Enter ${STANDARD_TABS.find((t) => t.key === activeTab)?.label.toLowerCase()} content...`}
          />
        )}

        {/* Custom sections */}
        {activeTab === 'custom' && (
          <div className="flex flex-col h-full min-h-0 gap-2">
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-sm font-medium text-foreground/80">Custom Sections</span>
              <button
                onClick={addCustomSection}
                className="px-2 py-1 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 flex items-center gap-1 ml-auto"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>

            {sp.customSections.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground/80">No custom sections yet</p>
              </div>
            ) : (
              <div className="flex flex-1 min-h-0 gap-2">
                {/* Custom section list */}
                <div className="w-36 flex-shrink-0 space-y-0.5 overflow-y-auto">
                  {sp.customSections.map((section, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors ${
                        selectedCustomIndex === index
                          ? 'bg-violet-500/10 text-foreground/80 border border-violet-500/20'
                          : 'text-muted-foreground/90 hover:bg-secondary/30 border border-transparent'
                      }`}
                      onClick={() => setSelectedCustomIndex(index)}
                    >
                      <span className="truncate flex-1">
                        {section.title || `Section ${index + 1}`}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCustomSection(index);
                        }}
                        className="p-0.5 text-muted-foreground/80 hover:text-red-400 flex-shrink-0"
                        title="Remove section"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Custom section editor */}
                {currentCustom && (
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
                    <input
                      type="text"
                      value={currentCustom.title}
                      onChange={(e) => updateCustomSection(selectedCustomIndex, 'title', e.target.value)}
                      className="px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 flex-shrink-0"
                      placeholder="Section title..."
                    />
                    <div className="flex-1 min-h-0">
                      <SectionEditor
                        value={currentCustom.content}
                        onChange={(v) => updateCustomSection(selectedCustomIndex, 'content', v)}
                        label={currentCustom.title || 'Custom Section'}
                        placeholder="Section content..."
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
