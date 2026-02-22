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
  Eye,
} from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface PromptTab {
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
  const tabs = useMemo<PromptTab[]>(() => {
    const sp = designResult.structured_prompt;
    const list: PromptTab[] = [];

    if (sp.identity) list.push({ key: 'identity', label: 'Identity', Icon: Brain, content: sp.identity });
    if (sp.instructions) list.push({ key: 'instructions', label: 'Instructions', Icon: FileText, content: sp.instructions });
    if (sp.toolGuidance) list.push({ key: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench, content: sp.toolGuidance });
    if (sp.examples) list.push({ key: 'examples', label: 'Examples', Icon: Code2, content: sp.examples });
    if (sp.errorHandling) list.push({ key: 'errorHandling', label: 'Error Handling', Icon: ShieldAlert, content: sp.errorHandling });

    if (sp.customSections) {
      for (const cs of sp.customSections) {
        list.push({
          key: `custom_${cs.key}`,
          label: cs.label,
          Icon: Sparkles,
          content: cs.content,
        });
      }
    }

    return list;
  }, [designResult.structured_prompt]);

  const [activeTab, setActiveTab] = useState(tabs[0]?.key ?? '');
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const activeSection = tabs.find((t) => t.key === activeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const TabIcon = tab.Icon;
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-violet-500/10 border-violet-500/20 text-violet-300'
                  : 'border-transparent text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="border-t border-primary/10">
        <AnimatePresence mode="wait">
          {activeSection && (
            <motion.div
              key={activeSection.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="max-h-[400px] overflow-y-auto p-4"
            >
              <MarkdownRenderer content={activeSection.content} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full prompt toggle */}
      {designResult.full_prompt_markdown && (
        <div className="border-t border-primary/10">
          <button
            onClick={() => setShowFullPrompt(!showFullPrompt)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground/90 hover:text-muted-foreground transition-colors w-full"
          >
            <Eye className="w-3.5 h-3.5" />
            {showFullPrompt ? 'Hide' : 'View'} Full Prompt
            {showFullPrompt ? (
              <ChevronDown className="w-3 h-3 ml-auto" />
            ) : (
              <ChevronRight className="w-3 h-3 ml-auto" />
            )}
          </button>
          <AnimatePresence>
            {showFullPrompt && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="max-h-[500px] overflow-y-auto px-4 pb-4 border-t border-primary/[0.06]">
                  <MarkdownRenderer content={designResult.full_prompt_markdown} className="mt-3" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
