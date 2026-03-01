import { useMemo } from 'react';
import { Check, Key, Zap, Play, FileText, AlertTriangle, ChevronRight, type LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface DesignPhaseAppliedProps {
  result: DesignAnalysisResult | null;
  warnings?: string[];
  onReset: () => void;
}

interface NextStep {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
  action: () => void;
}

export function DesignPhaseApplied({ result, warnings = [], onReset }: DesignPhaseAppliedProps) {
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const hasWarnings = warnings.length > 0;

  // Build summary stats from the applied result
  const stats = useMemo(() => {
    if (!result) return [];
    const items: Array<{ label: string; count: number }> = [];
    if (result.full_prompt_markdown) items.push({ label: 'prompt', count: 1 });
    if (result.suggested_tools?.length) items.push({ label: result.suggested_tools.length === 1 ? 'tool' : 'tools', count: result.suggested_tools.length });
    if (result.suggested_triggers?.length) items.push({ label: result.suggested_triggers.length === 1 ? 'trigger' : 'triggers', count: result.suggested_triggers.length });
    if (result.suggested_connectors?.length) items.push({ label: result.suggested_connectors.length === 1 ? 'connector' : 'connectors', count: result.suggested_connectors.length });
    if (result.suggested_notification_channels?.length) items.push({ label: result.suggested_notification_channels.length === 1 ? 'channel' : 'channels', count: result.suggested_notification_channels.length });
    if (result.suggested_event_subscriptions?.length) items.push({ label: result.suggested_event_subscriptions.length === 1 ? 'subscription' : 'subscriptions', count: result.suggested_event_subscriptions.length });
    return items;
  }, [result]);

  // Build contextual next-step cards based on what was created
  const nextSteps = useMemo<NextStep[]>(() => {
    const steps: NextStep[] = [];

    if ((result?.suggested_connectors?.length ?? 0) > 0) {
      steps.push({
        id: 'credentials',
        icon: Key,
        title: 'Configure Credentials',
        description: 'Connect the services your agent needs',
        color: '#22c55e',
        action: () => { onReset(); setSidebarSection('credentials'); },
      });
    }

    if ((result?.suggested_triggers?.length ?? 0) > 0) {
      steps.push({
        id: 'triggers',
        icon: Zap,
        title: 'Set Up Triggers',
        description: 'Configure when your agent should run',
        color: '#f59e0b',
        action: () => { onReset(); setEditorTab('connectors'); },
      });
    }

    steps.push({
      id: 'test',
      icon: Play,
      title: 'Run Test Execution',
      description: 'Verify your agent works as expected',
      color: '#6366f1',
      action: () => { onReset(); setEditorTab('use-cases'); },
    });

    if (result?.full_prompt_markdown) {
      steps.push({
        id: 'prompt',
        icon: FileText,
        title: 'Review Prompt',
        description: 'Fine-tune the generated prompt',
        color: '#06b6d4',
        action: () => { onReset(); setEditorTab('prompt'); },
      });
    }

    return steps;
  }, [result, onReset, setSidebarSection, setEditorTab]);

  return (
    <motion.div
      key="applied"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center py-8 gap-5"
    >
      {/* Animated success checkmark */}
      <div className="relative">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
          className={`w-14 h-14 rounded-full flex items-center justify-center ${
            hasWarnings
              ? 'bg-amber-500/15 ring-2 ring-amber-500/30'
              : 'bg-emerald-500/15 ring-2 ring-emerald-500/30'
          }`}
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.3 }}
          >
            {hasWarnings
              ? <AlertTriangle className="w-6 h-6 text-amber-400" />
              : <Check className="w-6 h-6 text-emerald-400" strokeWidth={3} />
            }
          </motion.div>
        </motion.div>
        {/* Expanding pulse ring on success */}
        {!hasWarnings && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full ring-2 ring-emerald-500/40"
          />
        )}
      </div>

      {/* Title + summary */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center"
      >
        <h3 className={`text-base font-semibold ${hasWarnings ? 'text-amber-400' : 'text-emerald-400'}`}>
          {hasWarnings ? `Applied with ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}` : 'Agent configured!'}
        </h3>
        {result?.summary && (
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto line-clamp-2">
            {result.summary}
          </p>
        )}
      </motion.div>

      {/* Stats pills showing what was created */}
      {stats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-wrap justify-center gap-1.5"
        >
          {stats.map((s) => (
            <span
              key={s.label}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono bg-secondary/50 border border-primary/10 text-muted-foreground/80"
            >
              <span className="text-foreground/90 font-semibold">{s.count}</span>
              {s.label}
            </span>
          ))}
        </motion.div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="w-full max-w-sm px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
        >
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-400/90 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Next-step cards */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="w-full max-w-sm"
      >
        <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-2 text-center">
          Next steps
        </p>
        <div className="space-y-1.5">
          {nextSteps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.button
                key={step.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 + i * 0.07 }}
                onClick={step.action}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:border-primary/20 transition-all group text-left"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
                  style={{
                    backgroundColor: step.color + '12',
                    borderColor: step.color + '25',
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color: step.color + 'cc' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground/85 group-hover:text-foreground/95 transition-colors">
                    {step.title}
                  </div>
                  <div className="text-xs text-muted-foreground/60">
                    {step.description}
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all shrink-0" />
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* Subtle close link */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        onClick={onReset}
        className="mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
      >
        Close
      </motion.button>
    </motion.div>
  );
}
