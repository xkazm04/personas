import { useMemo } from 'react';
import { Key, Zap, Play, FileText, ChevronRight, type LucideIcon } from 'lucide-react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useSystemStore } from "@/stores/systemStore";
import type { AgentIR } from '@/lib/types/designTypes';

interface NextStep {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
  action: () => void;
}

interface DesignPhaseAppliedDetailsProps {
  result: AgentIR | null;
  onReset: () => void;
}

export function DesignPhaseAppliedDetails({ result, onReset }: DesignPhaseAppliedDetailsProps) {
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

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
        id: 'credentials', icon: Key, title: 'Configure Credentials',
        description: 'Connect the services your agent needs', color: '#22c55e',
        action: () => { onReset(); setSidebarSection('credentials'); },
      });
    }
    if ((result?.suggested_triggers?.length ?? 0) > 0) {
      steps.push({
        id: 'triggers', icon: Zap, title: 'Set Up Triggers',
        description: 'Configure when your agent should run', color: '#f59e0b',
        action: () => { onReset(); setEditorTab('connectors'); },
      });
    }
    steps.push({
      id: 'test', icon: Play, title: 'Run Test Execution',
      description: 'Verify your agent works as expected', color: '#6366f1',
      action: () => { onReset(); setEditorTab('use-cases'); },
    });
    if (result?.full_prompt_markdown) {
      steps.push({
        id: 'prompt', icon: FileText, title: 'Review Prompt',
        description: 'Fine-tune the generated prompt', color: '#06b6d4',
        action: () => { onReset(); setEditorTab('prompt'); },
      });
    }
    return steps;
  }, [result, onReset, setSidebarSection, setEditorTab]);

  return (
    <>
      {/* Stats pills showing what was created */}
      {stats.length > 0 && (
        <div
          className="animate-fade-slide-in flex flex-wrap justify-center gap-1.5"
        >
          {stats.map((s) => (
            <span
              key={s.label}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-mono bg-secondary/50 border border-primary/10 text-muted-foreground/80"
            >
              <span className="text-foreground/90 font-semibold">{s.count}</span>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* Next-step cards */}
      <div
        className="animate-fade-slide-in w-full max-w-sm"
      >
        <p className="text-sm font-mono text-muted-foreground/50 uppercase tracking-widest mb-2 text-center">
          Next steps
        </p>
        <div className="space-y-1.5">
          {nextSteps.map((step, _i) => {
            const Icon = step.icon;
            return (
              <button
                key={step.id}
                onClick={step.action}
                className="animate-fade-slide-in w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:border-primary/20 transition-all group text-left"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
                  style={{
                    backgroundColor: colorWithAlpha(step.color, 0.07),
                    borderColor: colorWithAlpha(step.color, 0.15),
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color: colorWithAlpha(step.color, 0.8) }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground/85 group-hover:text-foreground/95 transition-colors">
                    {step.title}
                  </div>
                  <div className="text-sm text-muted-foreground/60">
                    {step.description}
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
