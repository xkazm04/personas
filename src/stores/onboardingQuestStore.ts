import { create } from 'zustand';
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { silentCatch } from '@/lib/silentCatch';

const SETTING_KEY = 'onboarding_quest_state';

export type QuestMilestoneId =
  | 'create_persona'
  | 'connect_credential'
  | 'run_persona'
  | 'save_memory'
  | 'schedule_trigger'
  | 'try_recipe'
  | 'share_deployment';

export const QUEST_MILESTONE_IDS: readonly QuestMilestoneId[] = [
  'create_persona',
  'connect_credential',
  'run_persona',
  'save_memory',
  'schedule_trigger',
  'try_recipe',
  'share_deployment',
] as const;

export interface QuestPersistedState {
  milestones: Partial<Record<QuestMilestoneId, string>>;
  dismissed: boolean;
  completedAt: string | null;
  /** When false, hide the pill entirely (e.g. user explicitly hid it after completion). */
  visible: boolean;
}

interface OnboardingQuestStore extends QuestPersistedState {
  hydrated: boolean;
  expanded: boolean;
  /** Most recently completed milestone id — drives the celebratory burst. */
  burstFor: QuestMilestoneId | null;

  hydrate: () => Promise<void>;
  completeMilestone: (id: QuestMilestoneId) => void;
  dismiss: () => void;
  revive: () => void;
  setExpanded: (open: boolean) => void;
  clearBurst: () => void;
}

const DEFAULT_STATE: QuestPersistedState = {
  milestones: {},
  dismissed: false,
  completedAt: null,
  visible: true,
};

function isMilestoneId(value: string): value is QuestMilestoneId {
  return (QUEST_MILESTONE_IDS as readonly string[]).includes(value);
}

function parsePersisted(raw: string | null): QuestPersistedState {
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<QuestPersistedState>;
    const milestones: Partial<Record<QuestMilestoneId, string>> = {};
    if (parsed.milestones && typeof parsed.milestones === 'object') {
      for (const [k, v] of Object.entries(parsed.milestones)) {
        if (isMilestoneId(k) && typeof v === 'string') {
          milestones[k] = v;
        }
      }
    }
    return {
      milestones,
      dismissed: Boolean(parsed.dismissed),
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      visible: parsed.visible !== false,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persist(state: QuestPersistedState): void {
  const payload: QuestPersistedState = {
    milestones: state.milestones,
    dismissed: state.dismissed,
    completedAt: state.completedAt,
    visible: state.visible,
  };
  void setAppSetting(SETTING_KEY, JSON.stringify(payload)).catch(
    silentCatch('onboardingQuestStore.persist'),
  );
}

export const useOnboardingQuestStore = create<OnboardingQuestStore>((set, get) => ({
  ...DEFAULT_STATE,
  hydrated: false,
  expanded: false,
  burstFor: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await getAppSetting(SETTING_KEY);
      const parsed = parsePersisted(raw);
      set({ ...parsed, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  completeMilestone: (id) => {
    const current = get();
    if (current.milestones[id]) return;
    const milestones = { ...current.milestones, [id]: new Date().toISOString() };
    const allDone = QUEST_MILESTONE_IDS.every((mid) => milestones[mid]);
    const completedAt =
      allDone && !current.completedAt ? new Date().toISOString() : current.completedAt;
    const next: QuestPersistedState = {
      milestones,
      dismissed: current.dismissed,
      completedAt,
      visible: current.visible,
    };
    set({ ...next, burstFor: id, expanded: true });
    persist(next);
  },

  dismiss: () => {
    const current = get();
    const next: QuestPersistedState = {
      milestones: current.milestones,
      dismissed: true,
      completedAt: current.completedAt,
      visible: false,
    };
    set({ ...next, expanded: false });
    persist(next);
  },

  revive: () => {
    const current = get();
    const next: QuestPersistedState = {
      milestones: current.milestones,
      dismissed: false,
      completedAt: current.completedAt,
      visible: true,
    };
    set({ ...next, expanded: true });
    persist(next);
  },

  setExpanded: (open) => set({ expanded: open }),

  clearBurst: () => set({ burstFor: null }),
}));

export function selectQuestProgress(s: OnboardingQuestStore): { done: number; total: number } {
  let done = 0;
  for (const id of QUEST_MILESTONE_IDS) {
    if (s.milestones[id]) done += 1;
  }
  return { done, total: QUEST_MILESTONE_IDS.length };
}
