import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { User, BookOpen, Wrench, Code, AlertTriangle, Plus, X, Check, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  migratePromptToStructured,
  parseStructuredPrompt,
  createEmptyStructuredPrompt,
} from '@/lib/personas/promptMigration';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';

type SubTab = 'identity' | 'instructions' | 'toolGuidance' | 'examples' | 'errorHandling' | string;

interface TabDef {
  key: SubTab;
  label: string;
  icon: React.ReactNode;
}

const STANDARD_TABS: TabDef[] = [
  { key: 'identity', label: 'Identity', icon: <User className="w-3.5 h-3.5" /> },
  { key: 'instructions', label: 'Instructions', icon: <BookOpen className="w-3.5 h-3.5" /> },
  { key: 'toolGuidance', label: 'Tool Guidance', icon: <Wrench className="w-3.5 h-3.5" /> },
  { key: 'examples', label: 'Examples', icon: <Code className="w-3.5 h-3.5" /> },
  { key: 'errorHandling', label: 'Error Handling', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
];

function PromptSection({
  title,
  icon,
  value,
  onChange,
  placeholder,
  codeStyle = false,
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  codeStyle?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/60">{icon}</span>
        <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full min-h-[300px] px-4 py-3 bg-background/50 border border-border/50 rounded-2xl text-foreground text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30 ${
            codeStyle ? 'font-mono' : 'font-sans'
          }`}
          placeholder={placeholder}
          spellCheck={!codeStyle}
        />
        <div className="absolute bottom-3 right-4 text-xs text-muted-foreground/30 font-mono pointer-events-none">
          {value.length.toLocaleString()} chars
        </div>
      </div>
    </div>
  );
}

export function PersonaPromptEditor() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const updatePersona = usePersonaStore((state) => state.updatePersona);

  const [activeTab, setActiveTab] = useState<SubTab>('instructions');
  const [sp, setSp] = useState<StructuredPrompt>(createEmptyStructuredPrompt());
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const personaIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spRef = useRef(sp);
  spRef.current = sp;
  const lastSavedJsonRef = useRef<string | null>(null);
  const lastLoadedPromptRef = useRef<string | null>(null);

  // Build dynamic tab list: standard tabs + one per custom section + add button
  const allTabs = useMemo(() => {
    const tabs: TabDef[] = [...STANDARD_TABS];
    sp.customSections.forEach((section, index) => {
      const label = section.title.length > 12
        ? section.title.slice(0, 12) + '...'
        : section.title;
      tabs.push({
        key: `custom_${index}`,
        label: label || 'Untitled',
        icon: <Code className="w-3.5 h-3.5" />,
      });
    });
    return tabs;
  }, [sp.customSections]);

  // Initialize structured prompt from persona data
  useEffect(() => {
    if (!selectedPersona) {
      // Clear auto-save timer to prevent saving to a deleted persona
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
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

    // Clear pending auto-save timer on persona switch or external update
    // to prevent saving stale data to the wrong persona
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

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

    setIsSaving(true);
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
    } finally {
      setIsSaving(false);
    }
  }, [updatePersona]);

  // Trigger debounced save when sp changes
  useEffect(() => {
    if (!personaIdRef.current) return;

    const jsonStr = JSON.stringify(sp);
    if (jsonStr === lastSavedJsonRef.current) return;

    // Capture the persona ID at schedule time so we can verify it hasn't
    // changed when the timer fires (defense-in-depth against race conditions)
    const scheduledForId = personaIdRef.current;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (personaIdRef.current !== scheduledForId) return;
      doSave();
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sp]);

  // Update a field in the structured prompt
  const updateField = useCallback((field: keyof Omit<StructuredPrompt, 'customSections'>, value: string) => {
    setSp((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Custom sections management
  const addCustomSection = useCallback(() => {
    setSp((prev) => {
      const newSections = [...prev.customSections, { title: 'New Section', content: '' }];
      return { ...prev, customSections: newSections };
    });
    const newIndex = sp.customSections.length;
    setActiveTab(`custom_${newIndex}`);
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
    setActiveTab('instructions');
  }, []);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/40">
        No persona selected
      </div>
    );
  }

  // Parse custom section index from tab key
  const customIndex = activeTab.startsWith('custom_')
    ? parseInt(activeTab.replace('custom_', ''), 10)
    : -1;
  const customSection = customIndex >= 0 ? sp.customSections[customIndex] : null;

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-secondary/40 border border-primary/15 rounded-xl overflow-x-auto">
          {allTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-muted-foreground/80'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}

          {/* Add Section button at end of tab bar */}
          <button
            onClick={addCustomSection}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors whitespace-nowrap"
            title="Add custom section"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Save status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <AnimatePresence>
            {showSaved && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 text-xs text-emerald-400"
              >
                <Check className="w-3 h-3" />
                Saved
              </motion.div>
            )}
          </AnimatePresence>
          {isSaving && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
              <Save className="w-3 h-3 animate-pulse" />
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'identity' && (
          <PromptSection
            title="Identity"
            icon={<User className="w-4 h-4" />}
            value={sp.identity}
            onChange={(v) => updateField('identity', v)}
            placeholder="Who is this persona? What role does it play?"
          />
        )}

        {activeTab === 'instructions' && (
          <PromptSection
            title="Instructions"
            icon={<BookOpen className="w-4 h-4" />}
            value={sp.instructions}
            onChange={(v) => updateField('instructions', v)}
            placeholder="Core instructions and behavioral guidelines..."
          />
        )}

        {activeTab === 'toolGuidance' && (
          <PromptSection
            title="Tool Guidance"
            icon={<Wrench className="w-4 h-4" />}
            value={sp.toolGuidance}
            onChange={(v) => updateField('toolGuidance', v)}
            placeholder="Guidelines for tool usage..."
          />
        )}

        {activeTab === 'examples' && (
          <PromptSection
            title="Examples"
            icon={<Code className="w-4 h-4" />}
            value={sp.examples}
            onChange={(v) => updateField('examples', v)}
            placeholder="Example interactions or outputs..."
            codeStyle
          />
        )}

        {activeTab === 'errorHandling' && (
          <PromptSection
            title="Error Handling"
            icon={<AlertTriangle className="w-4 h-4" />}
            value={sp.errorHandling}
            onChange={(v) => updateField('errorHandling', v)}
            placeholder="How should errors be handled?"
          />
        )}

        {/* Custom section tabs */}
        {customSection && customIndex >= 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customSection.title}
                onChange={(e) => updateCustomSection(customIndex, 'title', e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm font-medium bg-transparent border border-primary/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 text-foreground"
                placeholder="Section title..."
              />
              <button
                onClick={() => removeCustomSection(customIndex)}
                className="p-1.5 text-muted-foreground/40 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                title="Remove section"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <PromptSection
              title={customSection.title}
              icon={<Code className="w-4 h-4" />}
              value={customSection.content}
              onChange={(v) => updateCustomSection(customIndex, 'content', v)}
              placeholder="Section content..."
            />
          </div>
        )}
      </div>
    </div>
  );
}
