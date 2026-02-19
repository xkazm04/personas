import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Brain,
  FileText,
  Wrench,
  Code2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface PromptSection {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  content: string;
}

export function TemplatePromptPreview({
  designResult,
}: {
  designResult: DesignAnalysisResult;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const sections = useMemo<PromptSection[]>(() => {
    const sp = designResult.structured_prompt;
    const builtIn: PromptSection[] = [];

    if (sp.identity) builtIn.push({ key: 'identity', label: 'Identity', Icon: Brain, content: sp.identity });
    if (sp.instructions) builtIn.push({ key: 'instructions', label: 'Instructions', Icon: FileText, content: sp.instructions });
    if (sp.toolGuidance) builtIn.push({ key: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench, content: sp.toolGuidance });
    if (sp.examples) builtIn.push({ key: 'examples', label: 'Examples', Icon: Code2, content: sp.examples });
    if (sp.errorHandling) builtIn.push({ key: 'errorHandling', label: 'Error Handling', Icon: ShieldAlert, content: sp.errorHandling });

    if (sp.customSections) {
      for (const cs of sp.customSections) {
        builtIn.push({
          key: `custom_${cs.label}`,
          label: cs.label,
          Icon: Sparkles,
          content: cs.content,
        });
      }
    }

    return builtIn;
  }, [designResult.structured_prompt]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide hover:text-foreground/90 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        Prompt Preview
        <span className="text-xs text-muted-foreground/40 font-normal">
          ({sections.length} sections)
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-1.5">
              {sections.map((section) => {
                const SectionIcon = section.Icon;
                const sectionOpen = openSections.has(section.key);
                return (
                  <div key={section.key} className="bg-secondary/20 border border-primary/[0.08] rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection(section.key)}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left hover:bg-primary/5 transition-colors"
                    >
                      {sectionOpen ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                      )}
                      <SectionIcon className="w-3.5 h-3.5 text-violet-400/70" />
                      <span className="text-xs font-medium text-foreground/60">{section.label}</span>
                    </button>
                    <AnimatePresence initial={false}>
                      {sectionOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3.5 py-2.5 border-t border-primary/[0.08] max-h-[300px] overflow-y-auto">
                            <pre className="text-xs text-foreground/60 whitespace-pre-wrap font-sans leading-relaxed">{section.content}</pre>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
