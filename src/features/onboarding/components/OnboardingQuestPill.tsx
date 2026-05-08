import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Check, ChevronDown, Sparkles, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  QUEST_MILESTONE_IDS,
  selectQuestProgress,
  useOnboardingQuestStore,
  type QuestMilestoneId,
} from '@/stores/onboardingQuestStore';
import { useTranslation } from '@/i18n/useTranslation';
import { typedListen, EventName } from '@/lib/eventRegistry';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { silentCatch } from '@/lib/silentCatch';

const RING_SIZE = 36;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const BURST_DURATION_MS = 1800;
const AUTO_DISMISS_AFTER_MS = 6000;

/** CDC tables → milestone ids. The CDC drain emits CdcNotification on table change. */
const CDC_TABLE_TO_MILESTONE: Readonly<Record<string, QuestMilestoneId>> = {
  personas: 'create_persona',
  persona_credentials: 'connect_credential',
  persona_memories: 'save_memory',
  persona_triggers: 'schedule_trigger',
};

interface CdcPayload {
  action?: 'insert' | 'update' | 'delete';
  table?: string;
}

function useQuestTracker(): void {
  const completeMilestone = useOnboardingQuestStore((s) => s.completeMilestone);
  const hydrated = useOnboardingQuestStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    const unlisteners: UnlistenFn[] = [];

    // CDC notifications (single channel per table emitted by Rust db/cdc.rs).
    for (const [table, milestone] of Object.entries(CDC_TABLE_TO_MILESTONE)) {
      const eventName = (() => {
        switch (table) {
          case 'personas':
            return 'persona-health-changed';
          case 'persona_credentials':
            return 'credential-updated';
          case 'persona_memories':
            return 'memory-updated';
          case 'persona_triggers':
            return 'trigger-updated';
          default:
            return null;
        }
      })();
      if (!eventName) continue;
      void listen<CdcPayload>(eventName, (event) => {
        const action = event.payload?.action;
        if (action === 'delete') return;
        completeMilestone(milestone);
      })
        .then((un) => unlisteners.push(un))
        .catch(silentCatch(`onboardingQuest:listen:${eventName}`));
    }

    // Run a persona — mark complete on first execution status of any kind.
    void typedListen(EventName.EXECUTION_STATUS, () => {
      completeMilestone('run_persona');
    })
      .then((un) => unlisteners.push(un))
      .catch(silentCatch('onboardingQuest:listen:execution-status'));

    // Try a recipe.
    void typedListen(EventName.RECIPE_EXECUTION_STATUS, () => {
      completeMilestone('try_recipe');
    })
      .then((un) => unlisteners.push(un))
      .catch(silentCatch('onboardingQuest:listen:recipe-execution-status'));

    // Share a deployment — share-link-received fires when the OS opens a deep link
    // back to the app, which is a reasonable proxy for "the user shared something".
    void typedListen(EventName.SHARE_LINK_RECEIVED, () => {
      completeMilestone('share_deployment');
    })
      .then((un) => unlisteners.push(un))
      .catch(silentCatch('onboardingQuest:listen:share-link-received'));

    return () => {
      for (const un of unlisteners) {
        try {
          un();
        } catch {
          // unlisten can fail if Tauri context is gone; ignore.
        }
      }
    };
  }, [hydrated, completeMilestone]);
}

interface ConfettiBurstProps {
  show: boolean;
  reduceMotion: boolean;
}

function ConfettiBurst({ show, reduceMotion }: ConfettiBurstProps) {
  const particles = useMemo(() => {
    const colors = ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'];
    return Array.from({ length: 14 }).map((_, i) => {
      const angle = (i / 14) * Math.PI * 2;
      const distance = 36 + Math.random() * 18;
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        color: colors[i % colors.length],
        delay: Math.random() * 0.08,
      };
    });
  }, []);

  if (!show || reduceMotion) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: p.color }}
          initial={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          animate={{
            opacity: 0,
            scale: 0.4,
            x: p.x,
            y: p.y,
          }}
          transition={{ duration: 0.9, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

export default function OnboardingQuestPill() {
  const { t, tx } = useTranslation();
  const { shouldAnimate } = useMotion();
  const reduceMotion = !shouldAnimate;

  const hydrated = useOnboardingQuestStore((s) => s.hydrated);
  const visible = useOnboardingQuestStore((s) => s.visible);
  const dismissed = useOnboardingQuestStore((s) => s.dismissed);
  const completedAt = useOnboardingQuestStore((s) => s.completedAt);
  const milestones = useOnboardingQuestStore((s) => s.milestones);
  const expanded = useOnboardingQuestStore((s) => s.expanded);
  const burstFor = useOnboardingQuestStore((s) => s.burstFor);
  const hydrate = useOnboardingQuestStore((s) => s.hydrate);
  const setExpanded = useOnboardingQuestStore((s) => s.setExpanded);
  const dismiss = useOnboardingQuestStore((s) => s.dismiss);
  const clearBurst = useOnboardingQuestStore((s) => s.clearBurst);
  // 2026-05-07 — wrap in useShallow. `selectQuestProgress` returns a
  // fresh `{done, total}` object on every Zustand snapshot tick; without
  // shallow comparison Zustand's Object.is sees "different reference" on
  // every store update and forces a re-render, which re-subscribes →
  // re-renders → loop. Manifested as "getSnapshot should be cached →
  // Maximum update depth exceeded" the moment any agentStore action
  // fired (e.g. fetchPersonaSummaries on a credential health change).
  const progress = useOnboardingQuestStore(useShallow(selectQuestProgress));

  const [autoDismissArmed, setAutoDismissArmed] = useState(false);
  const autoDismissTimer = useRef<number | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useQuestTracker();

  // Auto-dismiss the pill ~6s after all milestones complete (revivable from TitleBar).
  useEffect(() => {
    if (!completedAt || dismissed || autoDismissArmed) return;
    setAutoDismissArmed(true);
    autoDismissTimer.current = window.setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_AFTER_MS);
    return () => {
      if (autoDismissTimer.current !== null) {
        window.clearTimeout(autoDismissTimer.current);
        autoDismissTimer.current = null;
      }
    };
  }, [completedAt, dismissed, autoDismissArmed, dismiss]);

  // Clear the burst sparkle after the animation runs.
  useEffect(() => {
    if (!burstFor) return;
    const id = window.setTimeout(() => clearBurst(), BURST_DURATION_MS);
    return () => window.clearTimeout(id);
  }, [burstFor, clearBurst]);

  const onToggle = useCallback(() => setExpanded(!expanded), [expanded, setExpanded]);

  if (!hydrated || !visible || dismissed) return null;

  const ringOffset = RING_CIRCUMFERENCE - (progress.done / progress.total) * RING_CIRCUMFERENCE;
  const isComplete = Boolean(completedAt);

  return (
    <div className="fixed bottom-4 right-4 z-40 pointer-events-none">
      <div className="pointer-events-auto">
        <AnimatePresence initial={false} mode="wait">
          {expanded ? (
            <motion.div
              key="expanded"
              initial={shouldAnimate ? { opacity: 0, y: 8, scale: 0.96 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldAnimate ? { opacity: 0, y: 8, scale: 0.98 } : { opacity: 0 }}
              transition={{ duration: shouldAnimate ? 0.18 : 0, ease: [0.22, 1, 0.36, 1] }}
              className="w-[320px] rounded-card bg-secondary/95 backdrop-blur-md border border-primary/15 shadow-elevation-3 overflow-hidden"
              role="dialog"
              aria-label={t.onboarding.quest_title}
            >
              <div className="flex items-start justify-between px-4 pt-3 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles size={16} className="text-amber-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="typo-body font-semibold truncate">
                      {isComplete ? t.onboarding.quest_complete_title : t.onboarding.quest_title}
                    </div>
                    <div className="typo-caption text-foreground/55 truncate">
                      {isComplete
                        ? t.onboarding.quest_complete_subtitle
                        : tx(t.onboarding.quest_progress, {
                            done: String(progress.done),
                            total: String(progress.total),
                          })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="p-1 rounded-input text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
                    aria-label={t.onboarding.quest_collapse}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="p-1 rounded-input text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
                    aria-label={t.onboarding.quest_dismiss}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <ul className="px-2 pb-2">
                {QUEST_MILESTONE_IDS.map((id) => {
                  const done = Boolean(milestones[id]);
                  const justCompleted = burstFor === id;
                  const labelKey = `quest_milestone_${id}` as const;
                  const hintKey = `quest_hint_${id}` as const;
                  const label = t.onboarding[labelKey];
                  const hint = t.onboarding[hintKey];
                  return (
                    <li
                      key={id}
                      className={`relative flex items-start gap-2.5 px-2 py-1.5 rounded-input ${
                        done ? 'opacity-60' : 'opacity-100'
                      } ${justCompleted ? 'bg-amber-400/10' : ''}`}
                    >
                      <div
                        className={`relative mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border ${
                          done
                            ? 'bg-emerald-500/80 border-emerald-400'
                            : 'bg-transparent border-foreground/30'
                        }`}
                      >
                        {done && <Check size={11} strokeWidth={3} className="text-white" />}
                        <ConfettiBurst show={justCompleted} reduceMotion={reduceMotion} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`typo-caption font-medium ${
                            done ? 'line-through text-foreground/55' : ''
                          }`}
                        >
                          {label}
                        </div>
                        {!done && hint && (
                          <div className="typo-caption text-foreground/45 mt-0.5">{hint}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          ) : (
            <motion.button
              key="pill"
              type="button"
              onClick={onToggle}
              initial={shouldAnimate ? { opacity: 0, scale: 0.85 } : false}
              animate={{ opacity: 1, scale: 1 }}
              exit={shouldAnimate ? { opacity: 0, scale: 0.85 } : { opacity: 0 }}
              transition={{ duration: shouldAnimate ? 0.18 : 0, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-secondary/95 backdrop-blur-md border border-primary/15 shadow-elevation-3 hover:border-primary/30 transition-colors"
              aria-label={t.onboarding.quest_expand}
              data-testid="onboarding-quest-pill"
            >
              <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
                <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={RING_STROKE}
                    className="text-foreground/15"
                  />
                  <motion.circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    className={isComplete ? 'text-emerald-400' : 'text-amber-300'}
                    strokeDasharray={RING_CIRCUMFERENCE}
                    initial={false}
                    animate={{ strokeDashoffset: ringOffset }}
                    transition={{ duration: shouldAnimate ? 0.5 : 0, ease: 'easeOut' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  {isComplete ? (
                    <Check size={14} className="text-emerald-400" strokeWidth={3} />
                  ) : (
                    <Sparkles size={12} className="text-amber-300" />
                  )}
                </div>
                <ConfettiBurst show={Boolean(burstFor)} reduceMotion={reduceMotion} />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="typo-caption font-semibold leading-tight">
                  {isComplete ? t.onboarding.quest_complete_title : t.onboarding.quest_title}
                </span>
                <span className="typo-caption text-foreground/55 leading-tight">
                  {tx(t.onboarding.quest_progress, {
                    done: String(progress.done),
                    total: String(progress.total),
                  })}
                </span>
              </div>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
