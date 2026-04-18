import { motion } from 'framer-motion';
import { Wand2, FileText, Link as LinkIcon, HeartPulse, Loader2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useHealthCheck } from '@/features/agents/health';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesignSubTab } from '@/lib/types/types';

const subTabs: { id: DesignSubTab; labelKey: 'design_sub_design' | 'design_sub_prompt' | 'design_sub_connectors'; icon: typeof FileText }[] = [
  { id: 'design', labelKey: 'design_sub_design', icon: Wand2 },
  { id: 'prompt', labelKey: 'design_sub_prompt', icon: FileText },
  { id: 'connectors', labelKey: 'design_sub_connectors', icon: LinkIcon },
];

const GRADE_TONE: Record<'healthy' | 'degraded' | 'unhealthy', string> = {
  healthy:   'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  degraded:  'border-amber-500/25 bg-amber-500/10 text-amber-400',
  unhealthy: 'border-red-500/25 bg-red-500/10 text-red-400',
};

/**
 * Top strip of the Design hub: sub-tab switcher + inline health summary badge.
 *
 * Absorbs the former standalone Health tab: the compact badge shows the
 * latest grade+score and lets the user re-run the check in place.
 */
export function DesignHubHeader() {
  const { t } = useTranslation();
  const designSubTab = useSystemStore((s) => s.designSubTab);
  const setDesignSubTab = useSystemStore((s) => s.setDesignSubTab);
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const health = useHealthCheck();
  const labels = t.agents.editor_ui;

  const running = health.phase === 'running';
  const score = health.score;
  const badgeTone = score ? GRADE_TONE[score.grade] : 'border-primary/15 bg-secondary/20 text-foreground';
  const badgeLabel = running
    ? labels.design_health_checking
    : score
      ? `${labels[`design_health_${score.grade}` as const] ?? score.grade} · ${score.value}`
      : labels.design_health_never_checked;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-primary/10 px-4 py-2">
      <nav className="flex items-center gap-1" aria-label="Design sub-navigation">
        {subTabs.map((tab) => {
          const Icon = tab.icon;
          const active = designSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDesignSubTab(tab.id)}
              data-testid={`design-sub-tab-${tab.id}`}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-card transition-colors ${
                active ? 'text-primary' : 'text-foreground hover:text-foreground/95'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {labels[tab.labelKey] ?? tab.labelKey}
              {active && (
                <motion.div
                  layoutId="designSubTabIndicator"
                  className="absolute -bottom-[9px] left-2 right-2 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={() => selectedPersona && health.runHealthCheck(selectedPersona)}
        disabled={running || !selectedPersona}
        title={labels.design_health_run}
        data-testid="design-health-badge"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card border typo-body transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${badgeTone} hover:opacity-90`}
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HeartPulse className="w-3.5 h-3.5" />}
        <span>{badgeLabel}</span>
      </button>
    </div>
  );
}
