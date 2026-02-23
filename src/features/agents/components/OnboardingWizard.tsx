import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Wand2,
  Bot,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { TemplatePickerStep } from '@/features/agents/components/onboarding/OnboardingTemplateStep';
import { IconSelector } from '@/features/shared/components/IconSelector';
import { ColorPicker } from '@/features/shared/components/ColorPicker';
import type { BuiltinTemplate } from '@/lib/types/templateTypes';

type WizardStep = 'template' | 'identity';

interface OnboardingWizardProps {
  /** When true, shows a Cancel button to exit the wizard without creating. */
  canCancel?: boolean;
}

export default function OnboardingWizard({ canCancel }: OnboardingWizardProps) {
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

  const [step, setStep] = useState<WizardStep>('template');
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

  const handleTemplateSelect = useCallback((template: BuiltinTemplate) => {
    setSelectedTemplate(template);
    setName(template.name);
    setDescription(template.description);
    setIcon(template.icon);
    setColor(template.color);
    setStep('identity');
  }, []);

  const handleFromScratch = useCallback(() => {
    setSelectedTemplate(null);
    setName('');
    setDescription('');
    setIcon('');
    setColor('#8b5cf6');
    setStep('identity');
  }, []);

  const handleBack = useCallback(() => {
    setStep('template');
  }, []);

  const handleCancel = useCallback(() => {
    setIsCreatingPersona(false);
  }, [setIsCreatingPersona]);

  const handleCreate = useCallback(async () => {
    const agentName = name.trim() || 'New Agent';
    if (isCreating) return;
    setIsCreating(true);

    try {
      const systemPrompt = selectedTemplate
        ? selectedTemplate.payload.full_prompt_markdown
        : 'You are a helpful AI assistant.';

      const persona = await createPersona({
        name: agentName,
        description: description.trim() || undefined,
        system_prompt: systemPrompt,
        icon: icon || undefined,
        color,
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
        // From-scratch with intent: auto-start design wizard
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

  return (
    <div className="flex items-center justify-center h-full overflow-y-auto">
      <AnimatePresence mode="wait">
        {step === 'template' ? (
          <TemplatePickerStep
            key="template"
            onSelect={handleTemplateSelect}
            onFromScratch={handleFromScratch}
            onCancel={canCancel ? handleCancel : undefined}
          />
        ) : (
          <motion.div
            key="identity"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-5 max-w-lg w-full px-6"
          >
            {/* Header */}
            <div>
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-muted-foreground/70 hover:text-muted-foreground mb-2 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back to templates
              </button>
              <h2 className="text-lg font-semibold text-foreground/90">
                {selectedTemplate ? 'Customize Agent' : 'New Agent'}
              </h2>
              <p className="text-sm text-muted-foreground/90 mt-1">
                {selectedTemplate
                  ? 'Review and customize before creating.'
                  : 'Describe what this agent should do.'}
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

            {/* From-scratch: intent field */}
            {!selectedTemplate && (
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5" />
                    What should this agent do?
                  </span>
                </label>
                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="Describe the agent's purpose and responsibilities...&#10;&#10;Example: Monitor my inbox for client emails and draft reply suggestions."
                  className="w-full h-28 px-3 py-2.5 bg-secondary/40 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
                  autoFocus
                />
                {intent.length > 0 && intent.trim().length < 10 && (
                  <p className="text-xs text-amber-400/70 mt-1">Add a bit more detail (at least 10 characters)</p>
                )}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedTemplate ? selectedTemplate.name : 'Agent name'}
                autoFocus={!!selectedTemplate}
                className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                Description <span className="text-muted-foreground/50 font-normal">(optional)</span>
              </label>
              <input
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
                      <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/10 bg-background/40" style={{ borderLeftWidth: 3, borderLeftColor: color }}>
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
                          <p className="text-sm font-medium text-foreground/85 truncate">{name.trim() || 'Agent Name'}</p>
                          <p className="text-xs text-muted-foreground/60 truncate">{description.trim() || 'Description'}</p>
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
