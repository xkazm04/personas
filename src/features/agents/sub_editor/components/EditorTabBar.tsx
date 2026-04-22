import { motion } from 'framer-motion';
import { ListChecks, FileText, Settings, FlaskConical, Check, Activity, MessageCircle, Wand2, HeartPulse } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import type { EditorTab } from '@/lib/types/types';
import { isTabDirty } from '../libs/editorTabConstants';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import type { Tier } from '@/lib/constants/uiModes';
import { TIERS } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';
import { useHealthCheck } from '@/features/agents/health';

type TabDefBase = { id: EditorTab; labelKey: string; icon: typeof FileText; devOnly?: boolean; minTier?: Tier };
const tabDefs: TabDefBase[] = [
  { id: 'activity', labelKey: 'tab_activity', icon: Activity, minTier: TIERS.TEAM },
  { id: 'design', labelKey: 'tab_design', icon: Wand2 },
  { id: 'use-cases', labelKey: 'tab_use_cases', icon: ListChecks },
  { id: 'lab', labelKey: 'tab_lab', icon: FlaskConical, minTier: TIERS.TEAM },
  { id: 'chat', labelKey: 'tab_chat', icon: MessageCircle },
  { id: 'settings', labelKey: 'tab_settings', icon: Settings },
];

interface EditorTabBarProps {
  dirtyTabs: string[];
  connectorsMissing: number;
  /** Tabs whose last save attempt failed — shown with an error badge so the
   *  user can see exactly which tab to recover. */
  failedTabs?: string[];
}

type TabBadgeVariant = 'dirty' | 'attention' | 'error' | 'success';

function TabBadge({ variant, count }: { variant: TabBadgeVariant; count?: number }) {
  if (variant === 'error') {
    return (
      <span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-red-500/15 border border-red-500/25 text-red-400 typo-caption leading-4 text-center">
        {count ?? '!'}
      </span>
    );
  }
  if (variant === 'success') {
    return (
      <span className="ml-auto w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-emerald-400" />
      </span>
    );
  }
  if (variant === 'attention') {
    return (
      <span className="ml-auto relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500" />
      </span>
    );
  }
  return <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />;
}

const GRADE_TONE: Record<'healthy' | 'degraded' | 'unhealthy', string> = {
  healthy:   'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  degraded:  'border-amber-500/25 bg-amber-500/10 text-amber-400',
  unhealthy: 'border-red-500/25 bg-red-500/10 text-red-400',
};

function HealthBadge() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const health = useHealthCheck();
  const labels = t.agents.editor_ui;
  const running = health.phase === 'running';
  const score = health.score;
  const badgeTone = score ? GRADE_TONE[score.grade] : 'border-primary/15 bg-secondary/40 text-foreground';
  const badgeLabel = running
    ? labels.design_health_checking
    : score
      ? `${labels[`design_health_${score.grade}` as const] ?? score.grade} · ${score.value}`
      : labels.design_health_never_checked;
  return (
    <button
      type="button"
      onClick={() => selectedPersona && health.runHealthCheck(selectedPersona)}
      disabled={running || !selectedPersona}
      title={labels.design_health_run}
      data-testid="editor-health-badge"
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card border typo-body transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap ${badgeTone} hover:opacity-90`}
    >
      <HeartPulse className="w-3.5 h-3.5" />
      <span>{badgeLabel}</span>
    </button>
  );
}

export function EditorTabBar({ dirtyTabs, connectorsMissing, failedTabs = [] }: EditorTabBarProps) {
  const { t } = useTranslation();
  const editorTab = useSystemStore((s) => s.editorTab);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const tier = useTier();
  const editorLabels = t.agents.editor_ui;
  return (
    <div className="border-b border-primary/10 bg-primary/5">
      <div className={`flex items-center ${IS_MOBILE ? 'px-1' : 'px-6'}`}>
        <div className={`flex overflow-x-auto flex-1 min-w-0 ${IS_MOBILE ? 'gap-0' : 'gap-1'} scrollbar-none`}>
          {tabDefs.filter((td) => (!td.devOnly || import.meta.env.DEV) && (!td.minTier || tier.isVisible(td.minTier))).map((tab) => {
            const Icon = tab.icon;
            const isActive = editorTab === tab.id;
            const tabDirty = isTabDirty(tab.id, dirtyTabs);
            const label = (editorLabels as Record<string, string>)[tab.labelKey] ?? tab.labelKey;
            return (
              <button
                key={tab.id}
                onClick={() => setEditorTab(tab.id)}
                data-testid={`editor-tab-${tab.id}`}
                title={label}
                className={`relative flex items-center gap-1.5 ${IS_MOBILE ? 'px-2.5 py-3' : 'px-3 py-2.5'} typo-heading transition-colors whitespace-nowrap ${
                  isActive ? 'text-primary' : 'text-foreground hover:text-foreground/95'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!IS_MOBILE && label}
                {failedTabs.includes(tab.id)
                  ? <TabBadge variant="error" />
                  : tab.id === 'design' && connectorsMissing > 0
                    ? <TabBadge variant="error" count={connectorsMissing} />
                    : tabDirty
                      ? <TabBadge variant="dirty" />
                      : isActive && !tabDirty
                        ? <TabBadge variant="success" />
                        : null}
                {isActive && (
                  <motion.div
                    layoutId="personaEditorTab"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {!IS_MOBILE && (
          <div className="pl-3 flex-shrink-0">
            <HealthBadge />
          </div>
        )}
      </div>
    </div>
  );
}
