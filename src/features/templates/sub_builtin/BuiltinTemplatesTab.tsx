import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/features/templates/animationPresets';
import {
  Code,
  MessageSquare,
  Shield,
  BookOpen,
  TestTube,
  Package,
  Bug,
  Database,
  GitPullRequest,
  FileText,
  FlaskConical,
  RefreshCw,
  Activity,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Wrench,
  Zap,
  Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BUILTIN_TEMPLATES } from '@/lib/personas/builtinTemplates';
import type { BuiltinTemplate } from '@/lib/types/templateTypes';
import { usePersonaStore } from '@/stores/personaStore';

const ICON_MAP: Record<string, LucideIcon> = {
  code: Code,
  'message-square': MessageSquare,
  MessageSquare: MessageSquare,
  shield: Shield,
  Shield: Shield,
  'book-open': BookOpen,
  'test-tube': TestTube,
  package: Package,
  bug: Bug,
  Bug: Bug,
  database: Database,
  GitPullRequest: GitPullRequest,
  FileText: FileText,
  FlaskConical: FlaskConical,
  RefreshCw: RefreshCw,
  Activity: Activity,
};

function getIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] || Sparkles;
}

export default function BuiltinTemplatesTab() {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const handleCreate = async (template: BuiltinTemplate) => {
    setCreatingId(template.id);
    try {
      const { payload } = template;

      // Build design_context summarizing tools, triggers, and connectors
      const contextParts: string[] = [];
      if (payload.suggested_tools.length > 0) {
        contextParts.push(`Tools: ${payload.suggested_tools.join(', ')}`);
      }
      if (payload.suggested_triggers.length > 0) {
        contextParts.push(`Triggers: ${payload.suggested_triggers.map((t) => t.description || t.trigger_type).join(', ')}`);
      }
      if (payload.suggested_connectors && payload.suggested_connectors.length > 0) {
        contextParts.push(`Connectors: ${payload.suggested_connectors.map((c) => c.name).join(', ')}`);
      }

      const persona = await createPersona({
        name: template.name,
        description: template.description,
        system_prompt: payload.full_prompt_markdown,
        icon: template.icon,
        color: template.color,
        structured_prompt: JSON.stringify(payload.structured_prompt),
        design_context: contextParts.length > 0 ? contextParts.join('. ') : undefined,
      });
      setCreatedId(template.id);
      setTimeout(() => {
        setCreatedId(null);
        selectPersona(persona.id);
      }, 1500);
    } catch (err) {
      console.error('Failed to create persona from template:', err);
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {BUILTIN_TEMPLATES.map((template) => {
          const Icon = getIcon(template.icon);
          const isExpanded = expandedId === template.id;
          const isCreating = creatingId === template.id;
          const isCreated = createdId === template.id;

          return (
            <motion.div
              key={template.id}
              variants={staggerItem}
              layout="position"
              className="rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/30 transition-colors overflow-hidden"
            >
              {/* Card header */}
              <div
                className="p-4 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : template.id)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
                    style={{
                      backgroundColor: `${template.color}18`,
                      borderColor: `${template.color}30`,
                    }}
                  >
                    <Icon className="w-5 h-5" style={{ color: template.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground/90 truncate">
                        {template.name}
                      </h3>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground/90 mt-0.5 line-clamp-2">
                      {template.description}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {template.category.map((cat) => (
                        <span
                          key={cat}
                          className="px-2 py-0.5 text-sm font-medium rounded-full bg-primary/8 text-muted-foreground/80 border border-primary/10"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 border-t border-primary/10 pt-3 space-y-3">
                      {/* Identity */}
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-1">
                          Identity
                        </h4>
                        <p className="text-sm text-foreground/90 leading-relaxed">
                          {template.payload.structured_prompt.identity}
                        </p>
                      </div>

                      {/* Tools */}
                      {template.payload.suggested_tools.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-1 flex items-center gap-1">
                            <Wrench className="w-3 h-3" />
                            Tools
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {template.payload.suggested_tools.map((tool) => (
                              <span
                                key={tool}
                                className="px-2 py-0.5 text-sm font-mono rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Triggers */}
                      {template.payload.suggested_triggers.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-1 flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            Triggers
                          </h4>
                          <div className="space-y-1">
                            {template.payload.suggested_triggers.map((trigger, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 text-sm text-foreground/80"
                              >
                                <span className="px-1.5 py-0.5 text-sm font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  {trigger.trigger_type}
                                </span>
                                <span className="truncate">{trigger.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Create button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreate(template);
                        }}
                        disabled={isCreating || isCreated}
                        className={`w-full mt-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors flex items-center justify-center gap-2 ${
                          isCreated
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                            : 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
                        }`}
                      >
                        {isCreated ? (
                          <>
                            <Check className="w-4 h-4" />
                            Persona Created
                          </>
                        ) : isCreating ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Create Persona
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
