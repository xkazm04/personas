import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { IconSelector } from '@/features/shared/components/forms/IconSelector';
import { ColorPicker } from '@/features/shared/components/forms/ColorPicker';
import type { BuilderState } from './builder/types';
import { toDesignContext, generateSystemPrompt, generateSummary } from './builder/builderReducer';
import { deriveNameFromState, deriveDescription, pageTransition } from './identityHelpers';
import { IdentityPreviewCard } from './IdentityPreviewCard';

interface IdentityStepProps {
  builderState: BuilderState;
  onBack: () => void;
  draftPersonaId?: string | null;
}

export function IdentityStep({ builderState, onBack, draftPersonaId }: IdentityStepProps) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const groups = usePersonaStore((s) => s.groups);

  const [name, setName] = useState(deriveNameFromState(builderState));
  const [description, setDescription] = useState(deriveDescription(builderState));
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [groupId, setGroupId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const summary = generateSummary(builderState);
  const canSubmit = name.trim().length > 0;

  const handleCreate = useCallback(async () => {
    const agentName = name.trim() || deriveNameFromState(builderState) || 'New Agent';
    if (isCreating) return;
    setIsCreating(true);

    try {
      const designContext = toDesignContext(builderState);
      const systemPrompt = generateSystemPrompt(builderState);

      let personaId: string;

      if (draftPersonaId) {
        await applyPersonaOp(draftPersonaId, {
          kind: 'ApplyDesignResult',
          updates: {
            name: agentName,
            description: description.trim() || builderState.intent.trim().slice(0, 200) || undefined,
            system_prompt: systemPrompt,
            icon: icon || undefined,
            color,
            design_context: JSON.stringify(designContext),
          },
        });
        personaId = draftPersonaId;
      } else {
        const persona = await createPersona({
          name: agentName,
          description: description.trim() || builderState.intent.trim().slice(0, 200) || undefined,
          system_prompt: systemPrompt,
          icon: icon || undefined,
          color,
          design_context: JSON.stringify(designContext),
        });
        personaId = persona.id;
      }

      await movePersonaToGroup(personaId, groupId || null);
      setSidebarSection('personas');
      selectPersona(personaId);
      setEditorTab('use-cases');
    } catch (err) {
      console.error('Failed to create persona:', err);
    } finally {
      setIsCreating(false);
    }
  }, [
    name, description, icon, color, groupId, builderState, isCreating,
    draftPersonaId, createPersona, applyPersonaOp, movePersonaToGroup, selectPersona,
    setSidebarSection, setEditorTab,
  ]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={pageTransition}
      className="w-full lg:min-w-[900px]"
    >
      {/* Header */}
      <div className="mb-6">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground/70 hover:text-muted-foreground mb-2 transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />Back
        </button>
        <h2 className="text-lg font-semibold text-foreground/90">New Agent</h2>
        <p className="text-sm text-muted-foreground/90 mt-1">Set a name and identity for your agent.</p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] 3xl:grid-cols-[1fr_400px] 4xl:grid-cols-[1fr_480px] gap-6">
        {/* Left column: form */}
        <div className="space-y-4 min-w-0">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" autoFocus
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all" />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">Description <span className="text-muted-foreground/50 font-normal">(optional)</span></label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description"
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all" />
          </div>

          {/* Appearance */}
          <div className="space-y-3">
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors">
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Customize appearance <span className="text-muted-foreground/60">(optional)</span>
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="space-y-4 p-4 bg-secondary/30 border border-primary/10 rounded-xl">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground/70 mb-2">Icon</label>
                        <IconSelector value={icon} onChange={setIcon} connectors={connectorDefinitions} size="sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground/70 mb-2">Color</label>
                        <ColorPicker value={color} onChange={setColor} size="sm" />
                      </div>
                    </div>
                    {groups.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-foreground/70 mb-1.5">Group</label>
                        <ThemedSelect value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                          <option value="">No group</option>
                          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </ThemedSelect>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Submit */}
          <button type="button" onClick={handleCreate} disabled={!canSubmit || isCreating}
            className={`btn-lg w-full flex items-center justify-center gap-2.5 font-medium transition-all ${canSubmit && !isCreating ? 'bg-btn-primary hover:bg-btn-primary/90 text-white shadow-lg shadow-btn-primary/20 hover:shadow-btn-primary/30 hover:scale-[1.01] active:scale-[0.99]' : 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'}`}
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isCreating ? 'Creating...' : 'Create Agent'}
          </button>
          {!canSubmit && !isCreating && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="text-muted-foreground text-xs mt-1.5 text-center">
              Enter a name to continue
            </motion.p>
          )}
        </div>

        {/* Right column: preview card */}
        <div className="space-y-4">
          <IdentityPreviewCard name={name} description={description} icon={icon} color={color} summary={summary} builderState={builderState} />
        </div>
      </div>
    </motion.div>
  );
}
