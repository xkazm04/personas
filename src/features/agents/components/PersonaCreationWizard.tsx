import { useState } from 'react';
import { Sparkles, Bot, ChevronDown, ChevronRight, Terminal, Zap, Wrench, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader } from '@/features/shared/components/ContentLayout';
import { IconSelector } from '@/features/shared/components/IconSelector';
import { ColorPicker } from '@/features/shared/components/ColorPicker';

export function PersonaCreationWizard() {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const setIsCreatingPersona = usePersonaStore((s) => s.setIsCreatingPersona);
  const setAutoStartDesignInstruction = usePersonaStore((s) => s.setAutoStartDesignInstruction);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const groups = usePersonaStore((s) => s.groups);

  const [intent, setIntent] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [groupId, setGroupId] = useState('');
  const [showIdentity, setShowIdentity] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const canSubmit = intent.trim().length >= 10;

  const handleCancel = () => {
    setIsCreatingPersona(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || isCreating) return;
    setIsCreating(true);

    try {
      const agentName = name.trim() || deriveName(intent);

      const p = await createPersona({
        name: agentName,
        description: description.trim() || intent.trim().slice(0, 200),
        system_prompt: 'You are a helpful AI assistant.',
        icon: icon || undefined,
        color,
      });

      if (groupId) {
        await movePersonaToGroup(p.id, groupId);
      }

      // Pass intent to DesignTab for auto-start
      setAutoStartDesignInstruction(intent.trim());
      selectPersona(p.id);
      setEditorTab('design');
    } catch {
      /* handled in store */
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Sparkles className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="New Agent"
        subtitle="Describe what you want and the AI Design Wizard will build it"
        actions={
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm font-medium text-muted-foreground/80 hover:text-foreground rounded-lg hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto flex gap-6">
          {/* Left: Form */}
          <div className="flex-1 space-y-5 min-w-0">
            {/* Primary: Intent */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
                <Wand2 className="w-3.5 h-3.5" />
                What should this agent do?
              </h4>
              <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-4">
                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="Describe the agent's purpose, responsibilities, and how it should behave...&#10;&#10;Example: Monitor my Gmail inbox for client emails, categorize them by urgency, and draft reply suggestions for high-priority messages."
                  className="w-full h-36 px-3 py-2.5 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
                  autoFocus
                />
                {intent.length > 0 && intent.trim().length < 10 && (
                  <p className="text-sm text-amber-400/70 mt-1.5">Describe in a bit more detail (at least 10 characters)</p>
                )}
              </div>
            </div>

            {/* Collapsible: Identity */}
            <div className="space-y-3">
              <button
                onClick={() => setShowIdentity(!showIdentity)}
                className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide hover:text-foreground transition-colors"
              >
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
                {showIdentity ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Customize Identity
                <span className="text-sm font-normal text-muted-foreground/60">(optional)</span>
              </button>

              <AnimatePresence>
                {showIdentity && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-4 space-y-4">
                      {/* Name */}
                      <div>
                        <label className="block text-sm font-medium text-foreground/80 mb-1">Name</label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Auto-generated from description"
                          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        />
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-sm font-medium text-foreground/80 mb-1">Description</label>
                        <input
                          type="text"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Short description (defaults to intent)"
                          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        />
                      </div>

                      {/* Icon + Color row */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground/80 mb-2">Icon</label>
                          <IconSelector value={icon} onChange={setIcon} connectors={connectorDefinitions} size="sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground/80 mb-2">Color</label>
                          <ColorPicker value={color} onChange={setColor} size="sm" />
                        </div>
                      </div>

                      {/* Group */}
                      {groups.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-foreground/80 mb-1">Group</label>
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
              onClick={handleSubmit}
              disabled={!canSubmit || isCreating}
              className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-medium text-sm transition-all ${
                canSubmit && !isCreating
                  ? 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
              }`}
            >
              <Wand2 className="w-4.5 h-4.5" />
              {isCreating ? 'Creating...' : 'Create & Design'}
            </button>
          </div>

          {/* Right: Preview + What happens next */}
          <div className="w-[260px] flex-shrink-0 space-y-5">
            {/* Preview card */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
                Preview
              </h4>
              <motion.div
                layout
                className="p-4 rounded-xl border border-primary/10 bg-secondary/30 relative overflow-hidden"
                style={{ borderLeftWidth: 3, borderLeftColor: color }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundColor: color, opacity: 0.04 }}
                />
                <div className="relative">
                  <div className="flex items-center gap-3 mb-2">
                    <AnimatePresence mode="wait">
                      {icon ? (
                        icon.startsWith('http') ? (
                          <motion.img
                            key={icon}
                            src={icon}
                            alt=""
                            className="w-8 h-8"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                          />
                        ) : (
                          <motion.span
                            key={icon}
                            className="text-2xl"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                          >
                            {icon}
                          </motion.span>
                        )
                      ) : (
                        <motion.div
                          key="default"
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: color + '20' }}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                        >
                          <Bot className="w-4 h-4" style={{ color }} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <h3 className="text-sm font-medium text-foreground/90 truncate">
                    {name.trim() || deriveName(intent) || <span className="text-muted-foreground/50">Agent Name</span>}
                  </h3>
                  <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2">
                    {description.trim() || intent.trim().slice(0, 80) || 'Description will appear here'}
                  </p>
                </div>
              </motion.div>
            </div>

            {/* What happens next */}
            <div className="space-y-3">
              <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
                <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
                <Sparkles className="w-3.5 h-3.5" />
                What happens next
              </h4>
              <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-2">
                {[
                  { icon: Wand2, label: 'AI Design Wizard analyzes your intent' },
                  { icon: Terminal, label: 'System prompt is generated' },
                  { icon: Wrench, label: 'Tools & triggers are suggested' },
                  { icon: Zap, label: 'You review and customize everything' },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-2.5 text-sm text-muted-foreground/80">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-primary/8 border border-primary/12 flex-shrink-0">
                      <step.icon className="w-3 h-3 text-primary/50" />
                    </div>
                    {step.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ContentBox>
  );
}

/** Derive a short agent name from the user's intent description. */
function deriveName(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return 'New Agent';
  // Take first ~30 chars, cut at word boundary
  const short = trimmed.slice(0, 30);
  const atWord = short.lastIndexOf(' ');
  const base = atWord > 10 ? short.slice(0, atWord) : short;
  return trimmed.length > base.length ? base + '...' : base;
}
