import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Sparkles, Bot, Key, Play, Brain, Clock, Wand2, Share2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  QUEST_MILESTONE_IDS,
  selectQuestProgress,
  useOnboardingQuestStore,
  type QuestMilestoneId,
} from '@/stores/onboardingQuestStore';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

interface MilestoneConfig {
  id: QuestMilestoneId;
  Icon: typeof Sparkles;
  ctaKey: 'next_step_cta_create_persona' | 'next_step_cta_connect_credential' | 'next_step_cta_run_persona' | 'next_step_cta_save_memory' | 'next_step_cta_schedule_trigger' | 'next_step_cta_try_recipe' | 'next_step_cta_share_deployment';
  navigate: (s: ReturnType<typeof useSystemStore.getState>, o: ReturnType<typeof useOverviewStore.getState>) => void;
}

const MILESTONE_CONFIG: Record<QuestMilestoneId, MilestoneConfig> = {
  create_persona: {
    id: 'create_persona',
    Icon: Bot,
    ctaKey: 'next_step_cta_create_persona',
    navigate: (s) => {
      s.setSidebarSection('personas');
      s.setAgentTab('create');
    },
  },
  connect_credential: {
    id: 'connect_credential',
    Icon: Key,
    ctaKey: 'next_step_cta_connect_credential',
    navigate: (s) => {
      s.setSidebarSection('credentials');
    },
  },
  run_persona: {
    id: 'run_persona',
    Icon: Play,
    ctaKey: 'next_step_cta_run_persona',
    navigate: (s) => {
      s.setSidebarSection('personas');
      s.setAgentTab('all');
    },
  },
  save_memory: {
    id: 'save_memory',
    Icon: Brain,
    ctaKey: 'next_step_cta_save_memory',
    navigate: (s, o) => {
      s.setSidebarSection('overview');
      o.setOverviewTab('knowledge');
    },
  },
  schedule_trigger: {
    id: 'schedule_trigger',
    Icon: Clock,
    ctaKey: 'next_step_cta_schedule_trigger',
    navigate: (s) => {
      s.setSidebarSection('personas');
      s.setEditorTab('design');
      s.setDesignSubTab('triggers');
    },
  },
  try_recipe: {
    id: 'try_recipe',
    Icon: Wand2,
    ctaKey: 'next_step_cta_try_recipe',
    navigate: (s) => {
      s.setSidebarSection('design-reviews');
      s.setTemplateTab('recipes');
    },
  },
  share_deployment: {
    id: 'share_deployment',
    Icon: Share2,
    ctaKey: 'next_step_cta_share_deployment',
    navigate: (s) => {
      s.setSidebarSection('personas');
      s.setAgentTab('cloud');
      s.setCloudTab('unified');
    },
  },
};

function selectNextMilestone(milestones: Partial<Record<QuestMilestoneId, string>>): QuestMilestoneId | null {
  for (const id of QUEST_MILESTONE_IDS) {
    if (!milestones[id]) return id;
  }
  return null;
}

export default function NextStepCoachCard() {
  const { t, tx } = useTranslation();
  const { shouldAnimate } = useMotion();

  const onboardingActive = useSystemStore((s) => s.onboardingActive);

  const hydrated = useOnboardingQuestStore((s) => s.hydrated);
  const dismissed = useOnboardingQuestStore((s) => s.dismissed);
  const milestones = useOnboardingQuestStore((s) => s.milestones);
  const burstFor = useOnboardingQuestStore((s) => s.burstFor);
  const hydrate = useOnboardingQuestStore((s) => s.hydrate);
  const dismiss = useOnboardingQuestStore((s) => s.dismiss);
  const progress = useOnboardingQuestStore(useShallow(selectQuestProgress));

  const [pulseKey, setPulseKey] = useState(0);
  const lastBurst = useRef<QuestMilestoneId | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (burstFor && burstFor !== lastBurst.current) {
      lastBurst.current = burstFor;
      setPulseKey((k) => k + 1);
    }
  }, [burstFor]);

  const next = useMemo(() => selectNextMilestone(milestones), [milestones]);

  const handleCta = useCallback(() => {
    if (!next) return;
    const cfg = MILESTONE_CONFIG[next];
    cfg.navigate(useSystemStore.getState(), useOverviewStore.getState());
  }, [next]);

  if (!hydrated) return null;
  if (onboardingActive) return null;
  if (dismissed) return null;

  const isComplete = next === null;
  if (isComplete) return null;

  const cfg = MILESTONE_CONFIG[next];
  const labelKey = `quest_milestone_${next}` as const;
  const hintKey = `quest_hint_${next}` as const;
  const label = t.onboarding[labelKey];
  const hint = t.onboarding[hintKey];
  const ctaLabel = t.onboarding[cfg.ctaKey];
  const stepIndex = QUEST_MILESTONE_IDS.indexOf(next) + 1;
  const Icon = cfg.Icon;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={next + ':' + pulseKey}
        initial={shouldAnimate ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldAnimate ? { opacity: 0, y: -4 } : { opacity: 0 }}
        transition={{ duration: shouldAnimate ? 0.22 : 0, ease: [0.22, 1, 0.36, 1] }}
        className="animate-fade-slide-in motion-reduce:animate-none w-full rounded-modal border border-amber-400/25 bg-secondary/40 backdrop-blur-sm overflow-hidden"
        data-testid="next-step-coach-card"
      >
        <div className="flex items-stretch gap-3 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-amber-400/15 text-amber-300">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 typo-caption text-amber-300/90">
              <Sparkles className="h-3 w-3" />
              <span className="uppercase tracking-wide font-semibold">{t.onboarding.next_step_eyebrow}</span>
              <span className="text-foreground/45">·</span>
              <span className="text-foreground/55">
                {tx(t.onboarding.next_step_progress, { step: String(stepIndex), total: String(progress.total) })}
              </span>
            </div>
            <div className="typo-body font-semibold text-foreground mt-0.5 truncate">{label}</div>
            {hint && (
              <div className="typo-caption text-foreground/55 mt-0.5 truncate">{hint}</div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleCta}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-amber-400/15 text-amber-200 hover:bg-amber-400/25 hover:text-amber-100 transition-colors typo-caption font-semibold group"
              data-testid="next-step-coach-cta"
            >
              <span>{ctaLabel}</span>
              <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="p-1.5 rounded-input text-foreground/50 hover:text-foreground hover:bg-primary/10 transition-colors"
              aria-label={t.onboarding.quest_dismiss}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="h-1 w-full bg-foreground/5">
          <motion.div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-300"
            initial={false}
            animate={{ width: `${(progress.done / progress.total) * 100}%` }}
            transition={{ duration: shouldAnimate ? 0.5 : 0, ease: 'easeOut' }}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
