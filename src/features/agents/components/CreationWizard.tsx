import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PenLine,
  Sparkles,
  Terminal,
  Wand2,
  Wrench,
  Zap,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { TemplatePickerStep } from '@/features/agents/components/onboarding/OnboardingTemplateStep';
import { IconSelector } from '@/features/shared/components/IconSelector';
import { ColorPicker } from '@/features/shared/components/ColorPicker';
import type { BuiltinTemplate } from '@/lib/types/templateTypes';

type WizardStep = 'entry' | 'identity';
type EntryMode = 'template' | 'describe';

interface CreationWizardProps {
  /** Show Cancel button to exit without creating. */
  canCancel?: boolean;
}

/** Derive a short agent name from the user's intent description. */
function deriveName(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return '';
  const short = trimmed.slice(0, 30);
  const atWord = short.lastIndexOf(' ');
  const base = atWord > 10 ? short.slice(0, atWord) : short;
  return trimmed.length > base.length ? base + '...' : base;
}

const pageTransition = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

export default function CreationWizard({ canCancel }: CreationWizardProps) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const setIsCreatingPersona = usePersonaStore((s) => s.setIsCreatingPersona);
  const setShowDesignNudge = usePersonaStore((s) => s.setShowDesignNudge);
  const setShowCloudNudge = usePersonaStore((s) => s.setShowCloudNudge);
  const setAutoStartDesignInstruction = usePersonaStore((s) => s.setAutoStartDesignInstruction);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const groups = usePersonaStore((s) => s.groups);

  const [step, setStep] = useState<WizardStep>('entry');
  const [entryMode, setEntryMode] = useState<EntryMode>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltinTemplate | null>(null);

  // Identity form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [intent, setIntent] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [groupId, setGroupId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // --- Entry step handlers ---

  const handleTemplateSelect = useCallback((template: BuiltinTemplate) => {
    setSelectedTemplate(template);
    setEntryMode('template');
    setName(template.name);
    setDescription(template.description);
    setIcon(template.icon);
    setColor(template.color);
    setStep('identity');
  }, []);

  const handleDescribeSubmit = useCallback(() => {
    if (intent.trim().length < 10) return;
    setSelectedTemplate(null);
    setEntryMode('describe');
    if (!name.trim()) setName(deriveName(intent));
    setStep('identity');
  }, [intent, name]);

  const handleBack = useCallback(() => {
    setStep('entry');
  }, []);

  const handleCancel = useCallback(() => {
    setIsCreatingPersona(false);
  }, [setIsCreatingPersona]);

  // --- Creation ---

  const handleCreate = useCallback(async () => {
    const agentName = name.trim() || deriveName(intent) || 'New Agent';
    if (isCreating) return;
    setIsCreating(true);

    try {
      const systemPrompt = selectedTemplate
        ? selectedTemplate.payload.full_prompt_markdown
        : 'You are a helpful AI assistant.';

      const structuredPrompt = selectedTemplate
        ? JSON.stringify(selectedTemplate.payload.structured_prompt)
        : undefined;

      // Build design_context for template-based creation
      let designContext: string | undefined;
      if (selectedTemplate) {
        const parts: string[] = [];
        if (selectedTemplate.payload.suggested_tools.length > 0) {
          parts.push(`Tools: ${selectedTemplate.payload.suggested_tools.join(', ')}`);
        }
        if (selectedTemplate.payload.suggested_triggers.length > 0) {
          parts.push(`Triggers: ${selectedTemplate.payload.suggested_triggers.map((t) => t.description || t.trigger_type).join(', ')}`);
        }
        if (selectedTemplate.payload.suggested_connectors && selectedTemplate.payload.suggested_connectors.length > 0) {
          parts.push(`Connectors: ${selectedTemplate.payload.suggested_connectors.map((c) => c.name).join(', ')}`);
        }
        if (parts.length > 0) designContext = parts.join('. ');
      }

      const persona = await createPersona({
        name: agentName,
        description: description.trim() || (intent.trim().slice(0, 200) || undefined),
        system_prompt: systemPrompt,
        icon: icon || undefined,
        color,
        structured_prompt: structuredPrompt,
        design_context: designContext,
      });

      if (groupId) {
        await movePersonaToGroup(persona.id, groupId);
      }

      setSidebarSection('personas');
      selectPersona(persona.id);

      if (selectedTemplate) {
        // Template-based: nudge to review design
        setShowDesignNudge(true);
        setShowCloudNudge(true);
      } else if (intent.trim().length >= 10) {
        // Intent-driven: auto-start design wizard
        setAutoStartDesignInstruction(intent.trim());
        setEditorTab('design');
      }
    } catch (err) {
      console.error('Failed to create persona:', err);
    } finally {
      setIsCreating(false);
    }
  }, [
    name, description, icon, color, groupId, intent, selectedTemplate, isCreating,
    createPersona, movePersonaToGroup, selectPersona, setSidebarSection,
    setEditorTab, setShowDesignNudge, setShowCloudNudge, setAutoStartDesignInstruction,
  ]);

  const canSubmit = selectedTemplate
    ? name.trim().length > 0
    : name.trim().length > 0 || intent.trim().length >= 10;

  // --- Render ---

  return (
    <div className="flex items-center justify-center h-full overflow-y-auto">
      <AnimatePresence mode="wait">
        {step === 'entry' ? (
          <motion.div
            key="entry"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={pageTransition}
            className="flex flex-col gap-5 max-w-lg w-full px-6"
          >
            {/* Mode tabs */}
            <div>
              <h2 className="text-lg font-semibold text-foreground/90">Create a New Agent</h2>
              <p className="text-sm text-muted-foreground/90 mt-1">
                Pick a starting point, or describe what you need.
              </p>
            </div>

            <div className="flex border border-primary/15 rounded-xl overflow-hidden" data-testid="creation-mode-tabs">
              <button
                data-testid="mode-template-btn"
                onClick={() => setEntryMode('template')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  entryMode === 'template'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Start from a template
              </button>
              <button
                data-testid="mode-describe-btn"
                onClick={() => setEntryMode('describe')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  entryMode === 'describe'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30'
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                Describe what you need
              </button>
            </div>

            {/* Mode content */}
            <AnimatePresence mode="wait">
              {entryMode === 'template' ? (
                <motion.div
                  key="template-picker"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <TemplatePickerStep
                    onSelect={handleTemplateSelect}
                    onFromScratch={() => setEntryMode('describe')}
                    onCancel={canCancel ? handleCancel : undefined}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="describe-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  {/* Intent textarea */}
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Wand2 className="w-3.5 h-3.5" />
                        What should this agent do?
                      </span>
                    </label>
                    <textarea
                      data-testid="intent-textarea"
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                      placeholder="Describe the agent's purpose, responsibilities, and how it should behave...&#10;&#10;Example: Monitor my Gmail inbox for client emails, categorize them by urgency, and draft reply suggestions for high-priority messages."
                      className="w-full h-36 px-3 py-2.5 bg-secondary/40 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
                      autoFocus
                    />
                    {intent.length > 0 && intent.trim().length < 10 && (
                      <p className="text-xs text-amber-400/70 mt-1">Add a bit more detail (at least 10 characters)</p>
                    )}
                  </div>

                  {/* What happens next */}
                  <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" />
                      What happens next
                    </p>
                    {[
                      { icon: Wand2, label: 'AI Design Wizard analyzes your intent' },
                      { icon: Terminal, label: 'System prompt is generated' },
                      { icon: Wrench, label: 'Tools & triggers are suggested' },
                      { icon: Zap, label: 'You review and customize everything' },
                    ].map((s) => (
                      <div key={s.label} className="flex items-center gap-2.5 text-sm text-muted-foreground/70">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center bg-primary/8 border border-primary/12 flex-shrink-0">
                          <s.icon className="w-2.5 h-2.5 text-primary/50" />
                        </div>
                        {s.label}
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-1">
                    {canCancel ? (
                      <button
                        data-testid="cancel-describe-btn"
                        onClick={handleCancel}
                        className="px-4 py-2.5 text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    ) : (
                      <div />
                    )}
                    <button
                      data-testid="continue-describe-btn"
                      onClick={handleDescribeSubmit}
                      disabled={intent.trim().length < 10}
                      className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 ${
                        intent.trim().length >= 10
                          ? 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                          : 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
                      }`}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Continue
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          /* ===== IDENTITY STEP (shared for both modes) ===== */
          <motion.div
            key="identity"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={pageTransition}
            className="flex flex-col gap-5 max-w-lg w-full px-6"
          >
            {/* Header */}
            <div>
              <button
                data-testid="back-to-entry-btn"
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-muted-foreground/70 hover:text-muted-foreground mb-2 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <h2 className="text-lg font-semibold text-foreground/90">
                {selectedTemplate ? 'Customize Agent' : 'New Agent'}
              </h2>
              <p className="text-sm text-muted-foreground/90 mt-1">
                {selectedTemplate
                  ? 'Review and customize before creating.'
                  : 'Set a name and identity for your agent.'}
              </p>
            </div>

            {/* Template badge */}
            {selectedTemplate && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-primary/15 bg-secondary/30">
                <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: selectedTemplate.color }} />
                <span className="text-sm text-foreground/80">
                  Based on <span className="font-medium">{selectedTemplate.name}</span>
                </span>
              </div>
            )}

            {/* Intent display (describe mode) */}
            {!selectedTemplate && intent.trim() && (
              <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-violet-500/15 bg-violet-500/5">
                <Wand2 className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-foreground/80 line-clamp-2">{intent.trim()}</p>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">Name</label>
              <input
                data-testid="agent-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedTemplate ? selectedTemplate.name : 'Agent name'}
                autoFocus
                className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                Description <span className="text-muted-foreground/50 font-normal">(optional)</span>
              </label>
              <input
                data-testid="agent-description-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={selectedTemplate ? selectedTemplate.description : 'Short description'}
                className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>

            {/* Advanced: Icon, Color, Group */}
            <div>
              <button
                data-testid="toggle-appearance-btn"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors"
              >
                {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Customize appearance
                <span className="text-muted-foreground/40">(optional)</span>
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-4 p-4 bg-secondary/30 border border-primary/10 rounded-xl">
                      {/* Preview */}
                      <div
                        className="flex items-center gap-3 p-3 rounded-lg border border-primary/10 bg-background/40"
                        style={{ borderLeftWidth: 3, borderLeftColor: color }}
                      >
                        {icon ? (
                          icon.startsWith('http') ? (
                            <img src={icon} alt="" className="w-8 h-8" />
                          ) : (
                            <span className="text-2xl">{icon}</span>
                          )
                        ) : (
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '20' }}>
                            <Bot className="w-4 h-4" style={{ color }} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground/85 truncate">
                            {name.trim() || deriveName(intent) || 'Agent Name'}
                          </p>
                          <p className="text-xs text-muted-foreground/60 truncate">
                            {description.trim() || 'Description'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-foreground/70 mb-2">Icon</label>
                          <IconSelector value={icon} onChange={setIcon} connectors={connectorDefinitions} size="sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground/70 mb-2">Color</label>
                          <ColorPicker value={color} onChange={setColor} size="sm" />
                        </div>
                      </div>

                      {groups.length > 0 && (
                        <div>
                          <label className="block text-xs font-medium text-foreground/70 mb-1.5">Group</label>
                          <div className="relative">
                            <select
                              data-testid="agent-group-select"
                              value={groupId}
                              onChange={(e) => setGroupId(e.target.value)}
                              className="w-full appearance-none px-3 py-2 pr-8 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                            >
                              <option value="">No group</option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/80 pointer-events-none" />
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Submit */}
            <button
              data-testid="create-agent-btn"
              onClick={handleCreate}
              disabled={!canSubmit || isCreating}
              className={`w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all ${
                canSubmit && !isCreating
                  ? 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
              }`}
            >
              {isCreating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {isCreating
                ? 'Creating...'
                : selectedTemplate
                  ? 'Create Agent'
                  : 'Create & Design'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
