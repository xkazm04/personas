import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  SkipForward,
  Sparkles,
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
  Loader2,
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

interface TemplatePickerStepProps {
  onBack: () => void;
}

export function TemplatePickerStep({ onBack }: TemplatePickerStepProps) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setShowDesignNudge = usePersonaStore((s) => s.setShowDesignNudge);
  const setShowCloudNudge = usePersonaStore((s) => s.setShowCloudNudge);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const handlePick = useCallback(
    async (template: BuiltinTemplate) => {
      setCreatingId(template.id);
      try {
        const persona = await createPersona({
          name: template.name,
          description: template.description,
          system_prompt: template.payload.full_prompt_markdown,
          icon: template.icon,
          color: template.color,
        });
        setSidebarSection('personas');
        selectPersona(persona.id);
        setShowDesignNudge(true);
        setShowCloudNudge(true);
      } catch (err) {
        console.error('Failed to create persona from template:', err);
      } finally {
        setCreatingId(null);
      }
    },
    [createPersona, selectPersona, setSidebarSection, setShowDesignNudge, setShowCloudNudge],
  );

  const handleSkip = () => {
    setSidebarSection('personas');
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5 max-w-lg w-full px-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground/90">Choose a Template</h2>
        <p className="text-xs text-muted-foreground/50 mt-1">
          Pick a template to create your first agent, or skip to start from scratch.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
        {BUILTIN_TEMPLATES.map((template, index) => {
          const Icon = getIcon(template.icon);
          const isCreating = creatingId === template.id;

          return (
            <motion.button
              key={template.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.25 }}
              onClick={() => handlePick(template)}
              disabled={creatingId !== null}
              className="flex items-start gap-3 p-3 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20 transition-colors text-left disabled:opacity-50"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border"
                style={{
                  backgroundColor: `${template.color}18`,
                  borderColor: `${template.color}30`,
                }}
              >
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: template.color }} />
                ) : (
                  <Icon className="w-4 h-4" style={{ color: template.color }} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/85 truncate">{template.name}</p>
                <p className="text-[11px] text-muted-foreground/45 line-clamp-2 leading-relaxed mt-0.5">
                  {template.description}
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleSkip}
          className="px-4 py-2.5 text-xs text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors flex items-center gap-1.5"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Skip for now
        </button>
      </div>
    </motion.div>
  );
}
