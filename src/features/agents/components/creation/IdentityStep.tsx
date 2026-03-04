import { useState, useCallback } from 'react';
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizeUrl';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import { IconSelector } from '@/features/shared/components/IconSelector';
import { ColorPicker } from '@/features/shared/components/ColorPicker';
import type { BuilderState } from './types';
import { toDesignContext, generateSystemPrompt, generateSummary } from './builderReducer';

interface IdentityStepProps {
  builderState: BuilderState;
  onBack: () => void;
  draftPersonaId?: string | null;
}

function deriveName(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return '';
  const short = trimmed.slice(0, 30);
  const atWord = short.lastIndexOf(' ');
  const base = atWord > 10 ? short.slice(0, atWord) : short;
  return trimmed.length > base.length ? base + '...' : base;
}

function deriveNameFromState(state: BuilderState): string {
  const firstUc = state.useCases.find((uc) => uc.title.trim());
  if (firstUc) return firstUc.title.trim();
  if (state.intent.trim()) return deriveName(state.intent);
  return '';
}

function deriveDescription(state: BuilderState): string {
  if (state.intent.trim()) return state.intent.trim().slice(0, 200);
  const descs = state.useCases.filter((uc) => uc.description.trim()).map((uc) => uc.description.trim());
  if (descs.length > 0) return descs.join('; ').slice(0, 200);
  return '';
}

const pageTransition = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

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
        // Update existing draft persona instead of creating a new one
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

      // Always move — either to selected group or to null (removes from Draft group)
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

  const filledUseCases = builderState.useCases.filter((uc) => uc.title.trim());

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={pageTransition}
      className="w-full"
      style={{ minWidth: 900 }}
    >
      {/* Header */}
      <div className="mb-5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground/70 hover:text-muted-foreground mb-2 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <h2 className="text-lg font-semibold text-foreground/90">New Agent</h2>
        <p className="text-sm text-muted-foreground/90 mt-1">
          Set a name and identity for your agent.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[1fr_320px] gap-6">
        {/* Left column: form */}
        <div className="space-y-5 min-w-0">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              autoFocus
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
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
              placeholder="Short description"
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>

          {/* Appearance: Icon, Color, Group — always visible in grid */}
          <div className="space-y-3">
            <button
              type="button"
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
                  <div className="space-y-4 p-4 bg-secondary/30 border border-primary/10 rounded-xl">
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
                        <ThemedSelect
                          value={groupId}
                          onChange={(e) => setGroupId(e.target.value)}
                        >
                          <option value="">No group</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </ThemedSelect>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canSubmit || isCreating}
            className={`w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all ${
              canSubmit && !isCreating
                ? 'bg-btn-primary hover:bg-btn-primary/90 text-white shadow-lg shadow-btn-primary/20 hover:shadow-btn-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                : 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
            }`}
          >
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {isCreating ? 'Creating...' : 'Create Agent'}
          </button>
        </div>

        {/* Right column: preview card */}
        <div className="space-y-4">
          {/* Agent preview */}
          <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Preview
            </p>

            {/* Card preview */}
            <div
              className="flex items-center gap-3 p-3 rounded-lg border border-primary/10 bg-background/40"
              style={{ borderLeftWidth: 3, borderLeftColor: color }}
            >
              {icon ? (
                sanitizeIconUrl(icon) ? (
                  <img src={sanitizeIconUrl(icon)!} alt="" className="w-8 h-8" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                ) : isIconUrl(icon) ? null : (
                  <span className="text-2xl">{icon}</span>
                )
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '20' }}>
                  <Bot className="w-4 h-4" style={{ color }} />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/85 truncate">
                  {name.trim() || deriveNameFromState(builderState) || 'Agent Name'}
                </p>
                <p className="text-xs text-muted-foreground/60 truncate">
                  {description.trim() || 'Description'}
                </p>
              </div>
            </div>

            {/* Summary */}
            {summary && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/5">
                <Sparkles className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                <span className="text-xs text-foreground/60">{summary}</span>
              </div>
            )}

            {/* Use cases */}
            {filledUseCases.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/55 mb-1.5">
                  Use Cases
                </p>
                <ul className="space-y-1">
                  {filledUseCases.slice(0, 5).map((uc) => (
                    <li key={uc.id} className="text-xs text-foreground/70 truncate">
                      {uc.title}
                    </li>
                  ))}
                  {filledUseCases.length > 5 && (
                    <li className="text-xs text-muted-foreground/50 italic">
                      +{filledUseCases.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Components */}
            {builderState.components.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/55 mb-1.5">
                  Components
                </p>
                <div className="flex flex-wrap gap-1">
                  {builderState.components.map((comp) => (
                    <span
                      key={comp.id}
                      className="inline-flex items-center px-1.5 py-0.5 bg-secondary/40 rounded text-[11px] text-foreground/70"
                    >
                      {comp.connectorName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Trigger + Policies */}
            {(builderState.globalTrigger || builderState.errorStrategy !== 'halt' || builderState.reviewPolicy !== 'never') && (
              <div className="space-y-1">
                {builderState.globalTrigger && (
                  <p className="text-xs text-foreground/60">
                    <span className="text-muted-foreground/55">Schedule:</span> {builderState.globalTrigger.label}
                  </p>
                )}
                {builderState.errorStrategy !== 'halt' && (
                  <p className="text-xs text-foreground/60">
                    <span className="text-muted-foreground/55">Errors:</span> {builderState.errorStrategy}
                  </p>
                )}
                {builderState.reviewPolicy !== 'never' && (
                  <p className="text-xs text-foreground/60">
                    <span className="text-muted-foreground/55">Review:</span> {builderState.reviewPolicy}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
