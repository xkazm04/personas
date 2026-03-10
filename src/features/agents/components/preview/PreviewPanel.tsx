import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Check,
  Loader2,
  Sparkles,
  Wrench,
  Zap,
  Clock,
  Bell,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { PreviewSection } from './PreviewSection';

import type { useDesignAnalysis } from '@/hooks/design/core/useDesignAnalysis';

type DesignAnalysis = ReturnType<typeof useDesignAnalysis>;

interface PreviewPanelProps {
  design: DesignAnalysis;
  completeness: number;
  isThinking: boolean;
  isActivating: boolean;
  previewExpanded: boolean;
  setPreviewExpanded: (v: boolean) => void;
  onActivate: () => void;
}

export function PreviewPanel({
  design,
  completeness,
  isThinking,
  isActivating,
  previewExpanded,
  setPreviewExpanded,
  onActivate,
}: PreviewPanelProps) {
  const result = design.result;
  if (!result) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 260, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="border-l border-primary/10 overflow-y-auto overflow-x-hidden"
      >
        <div className="p-3 space-y-3 w-[260px]">
          {/* Preview header */}
          <button
            onClick={() => setPreviewExpanded(!previewExpanded)}
            className="flex items-center gap-1.5 w-full text-left"
          >
            {previewExpanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
            }
            <span className="text-sm font-semibold text-muted-foreground/70 uppercase tracking-wider">Preview</span>
          </button>

          {previewExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2.5"
            >
              {/* Identity */}
              <PreviewSection icon={Bot} label="Identity">
                <p className="text-sm text-foreground/70 truncate">
                  {result.structured_prompt?.identity
                    ? result.structured_prompt.identity.slice(0, 80) + (result.structured_prompt.identity.length > 80 ? '...' : '')
                    : '—'}
                </p>
              </PreviewSection>

              {/* Prompt */}
              <PreviewSection icon={FileText} label="Prompt">
                <p className="text-sm text-foreground/70">
                  {result.full_prompt_markdown
                    ? `${result.full_prompt_markdown.split('\n').length} lines`
                    : '—'}
                </p>
              </PreviewSection>

              {/* Tools */}
              <PreviewSection icon={Wrench} label="Tools" count={result.suggested_tools.length}>
                {result.suggested_tools.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {result.suggested_tools.slice(0, 5).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 text-sm bg-primary/8 border border-primary/12 rounded text-foreground/60 truncate max-w-[100px]">
                        {t}
                      </span>
                    ))}
                    {result.suggested_tools.length > 5 && (
                      <span className="text-sm text-muted-foreground/50">
                        +{result.suggested_tools.length - 5}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/60">None yet</p>
                )}
              </PreviewSection>

              {/* Triggers */}
              <PreviewSection icon={Zap} label="Triggers" count={result.suggested_triggers.length}>
                {result.suggested_triggers.length > 0 ? (
                  <div className="space-y-0.5">
                    {result.suggested_triggers.map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Clock className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
                        <span className="text-sm text-foreground/60 truncate">
                          {t.description || t.trigger_type}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/60">None yet</p>
                )}
              </PreviewSection>

              {/* Subscriptions */}
              {(result.suggested_event_subscriptions ?? []).length > 0 && (
                <PreviewSection icon={Bell} label="Subscriptions" count={result.suggested_event_subscriptions!.length}>
                  <div className="space-y-0.5">
                    {result.suggested_event_subscriptions!.map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Bell className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
                        <span className="text-sm text-foreground/60 truncate">
                          {s.event_type}
                        </span>
                      </div>
                    ))}
                  </div>
                </PreviewSection>
              )}

              {/* Summary */}
              {result.summary && (
                <div className="px-2 py-1.5 bg-secondary/20 rounded-lg">
                  <p className="text-sm text-muted-foreground/60 leading-relaxed">
                    {result.summary}
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Activate button */}
          <button
            onClick={onActivate}
            disabled={isActivating || isThinking || completeness < 40}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              isActivating || isThinking || completeness < 40
                ? 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
                : completeness >= 80
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
            }`}
          >
            {isActivating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : completeness >= 80 ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isActivating ? 'Activating...' : completeness >= 80 ? 'Activate Agent' : 'Create Agent'}
          </button>
          {completeness < 40 && !isActivating && !isThinking && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="text-muted-foreground text-xs mt-1.5 text-center"
            >
              Add more detail to reach 40% completeness
            </motion.p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
