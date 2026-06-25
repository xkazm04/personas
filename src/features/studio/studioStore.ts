import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { COMPANION_STREAM_EVENT, type CompanionStreamEvent } from '@/api/companion';
import { extractAssistantTextDelta } from '@/features/plugins/companion/extractAssistantText';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { toastCatch } from '@/lib/silentCatch';
import {
  webbuildDevStart,
  webbuildDevStop,
  webbuildScaffold,
  webbuildSessionSend,
  webbuildSessionStop,
  webbuildStatus,
  type BuildEffort,
  type BuildStyle,
} from '@/api/webbuild';
import type { DevServerStatus } from '@/lib/bindings/DevServerStatus';
import { MOCK_PHASES, type BuildPhase } from './studioBuildModel';
import { useStudioHistory } from './studioHistory';

// Studio runs multiple projects in parallel like browser tabs. Each project's
// full build runtime lives HERE (not in a component) so a project keeps building
// while you're on another tab or another app module — the dev servers are Rust
// processes that already persist; this store persists the turn/stream/plan state
// that used to die with StudioChatInput on unmount.

export type StudioPhase = 'idle' | 'scaffolding' | 'starting' | 'live' | 'error';

/** One completed Athena reply — the chat history shows each as its own bubble. */
export interface StudioMessage {
  id: string;
  text: string;
  ts: number;
}

export interface ProjectRuntime {
  id: string;
  name: string;
  phase: StudioPhase;
  status: DevServerStatus | null;
  phases: BuildPhase[];
  busy: boolean;
  stream: string;
  reply: string | null;
  /** Every completed Athena reply this session, oldest→newest (1a history). */
  messages: StudioMessage[];
  question: string | null;
  autonomous: boolean;
  /** Vision text to auto-send as the first turn once the server is live. */
  seedPending: string | null;
  autoTurns: number;
  resumeAuto: boolean;
  /** Per-turn build controls (C1 effort, C4 voice/style). */
  effort: BuildEffort;
  style: BuildStyle;
  /** Clickable options for the current question (A1). Empty = free-text. */
  options: string[];
  /** Coarse preview region the current question is about (A3): top|middle|bottom. */
  decisionArea: string | null;
  /** CSS selector the current question is about (A3 precise orb pointer). */
  decisionSelector: string | null;
  /** C2 — plan-first gate: the seed turn plans + asks approval before editing. */
  gatePlan: boolean;
  /** C8 — enabled MCP connector ids for build turns. */
  mcp: string[];
}

const AUTO_MAX_TURNS = 12;

// C2 — plan-first gate: wrap the seed vision so Athena plans + asks approval
// before editing any files. "Build it" (an A1 decision option) resumes the build.
const planFirstSeed = (vision: string) =>
  `${vision}\n\n[Plan first — before editing ANY files this turn: reply with your proposed build plan and a 1-2 sentence approach, emit the BUILD_PLAN line, and end with NEEDS_INPUT {"question":"Approve this plan and start building?","options":["Build it","Let me adjust"]}. Do not edit files yet.]`;
const AUTO_INSTRUCTION =
  'Continue building — take the next phase of your plan to a solid, real state, then update your BUILD_PLAN. Decide the order yourself and keep going; do NOT ask which feature to build next or for permission to continue. Only use NEEDS_INPUT for real content or a business/data decision you genuinely cannot make. If everything is built and polished, say so and mark all phases done.';

// Non-serializable per-project handles kept outside store state.
const pollTimers = new Map<string, number>();
const autoTimers = new Map<string, number>();
let streamUnlisten: (() => void) | null = null;

interface StudioStore {
  runtimes: Record<string, ProjectRuntime>;
  tabOrder: string[];
  activeId: string | null;
  initStream: () => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  startExisting: (id: string, name: string) => Promise<void>;
  createWithVision: (name: string, vision: string) => Promise<void>;
  reload: (id: string) => void;
  sendTurn: (id: string, text: string) => Promise<void>;
  setBuildSettings: (
    id: string,
    p: { effort?: BuildEffort; style?: BuildStyle; gatePlan?: boolean; mcp?: string[] },
  ) => void;
  startAutonomous: (id: string) => void;
  stopAutonomous: (id: string) => void;
  stopTurn: (id: string) => void;
}

export const useStudioStore = create<StudioStore>((set, get) => {
  const patch = (id: string, p: Partial<ProjectRuntime>) =>
    set((s) => {
      const rt = s.runtimes[id];
      if (!rt) return s;
      return { runtimes: { ...s.runtimes, [id]: { ...rt, ...p } } };
    });

  const ensure = (id: string, name: string) => {
    // Restore the checklist + message log from the persisted snapshot if we have
    // one (re-opening a project after a restart); otherwise start fresh.
    const h = useStudioHistory.getState().byProject[id];
    set((s) => {
      if (s.runtimes[id]) {
        const order = s.tabOrder.includes(id) ? s.tabOrder : [...s.tabOrder, id];
        return { tabOrder: order, activeId: id };
      }
      const rt: ProjectRuntime = {
        id,
        name,
        phase: 'idle',
        status: null,
        phases: h?.phases ?? MOCK_PHASES,
        busy: false,
        stream: '',
        reply: h?.reply ?? null,
        messages: h?.messages ?? [],
        question: h?.question ?? null,
        autonomous: false,
        seedPending: null,
        autoTurns: 0,
        resumeAuto: false,
        effort: 'xhigh',
        style: 'balanced',
        options: h?.options ?? [],
        decisionArea: null,
        decisionSelector: null,
        gatePlan: false,
        mcp: [],
      };
      return {
        runtimes: { ...s.runtimes, [id]: rt },
        tabOrder: [...s.tabOrder, id],
        activeId: id,
      };
    });
  };

  // Persist the project's checklist + message log so it survives an app restart.
  const saveHistory = (id: string) => {
    const rt = get().runtimes[id];
    if (!rt) return;
    useStudioHistory.getState().save(id, {
      phases: rt.phases,
      messages: rt.messages,
      reply: rt.reply,
      question: rt.question,
      options: rt.options,
      updatedAt: Date.now(),
    });
  };

  const stopPoll = (id: string) => {
    const t = pollTimers.get(id);
    if (t) {
      window.clearInterval(t);
      pollTimers.delete(id);
    }
  };

  const beginPoll = (id: string) => {
    stopPoll(id);
    const timer = window.setInterval(() => {
      webbuildStatus(id)
        .then((status) => {
          patch(id, { status });
          if (status?.healthy) {
            patch(id, { phase: 'live' });
            stopPoll(id);
            // Auto-send the vision seed once the preview is live.
            const rt = get().runtimes[id];
            if (rt?.seedPending) {
              const seed = rt.gatePlan ? planFirstSeed(rt.seedPending) : rt.seedPending;
              patch(id, { seedPending: null });
              void get().sendTurn(id, seed);
            }
          }
        })
        .catch(() => {
          /* transient while booting */
        });
    }, 1500);
    pollTimers.set(id, timer);
  };

  const start = async (id: string) => {
    patch(id, { phase: 'starting', status: null });
    try {
      const status = await webbuildDevStart(id);
      patch(id, { status });
      beginPoll(id);
    } catch (e) {
      patch(id, { phase: 'error' });
      toastCatch('start dev server')(e);
    }
  };

  const stopAuto = (id: string) => {
    const t = autoTimers.get(id);
    if (t) {
      window.clearTimeout(t);
      autoTimers.delete(id);
    }
  };

  const runTurn = async (id: string, raw: string) => {
    const rt = get().runtimes[id];
    const text = raw.trim();
    if (!rt || rt.busy || !text) return;
    patch(id, {
      busy: true,
      reply: null,
      question: null,
      options: [],
      decisionArea: null,
      decisionSelector: null,
      stream: '',
    });
    useCompanionStore.getState().pulseForwardAck();
    try {
      const result = await webbuildSessionSend(id, text, rt.effort, rt.style, rt.mcp);
      const q = result.question?.trim() || null;
      const reply = result.reply.trim() || 'Done.';
      patch(id, {
        reply,
        messages: [
          ...(get().runtimes[id]?.messages ?? []),
          { id: crypto.randomUUID(), text: reply, ts: Date.now() },
        ],
        question: q,
        options: q ? (result.options ?? []) : [],
        decisionArea: q ? (result.area ?? null) : null,
        decisionSelector: q ? (result.selector ?? null) : null,
        ...(result.phases && result.phases.length > 0 ? { phases: result.phases } : {}),
      });
      useCompanionStore.getState().pulseMessageReaction();
      const cur = get().runtimes[id];
      if (q && cur?.autonomous) patch(id, { autonomous: false, resumeAuto: true });
      else if (!q && cur?.resumeAuto) patch(id, { resumeAuto: false, autonomous: true });
    } catch (e) {
      const reply = 'Something went wrong with that change.';
      patch(id, {
        reply,
        messages: [
          ...(get().runtimes[id]?.messages ?? []),
          { id: crypto.randomUUID(), text: reply, ts: Date.now() },
        ],
        autonomous: false,
        resumeAuto: false,
      });
      toastCatch('build instruction')(e);
    } finally {
      patch(id, { busy: false });
      saveHistory(id);
      // Chain the next autonomous turn.
      const cur = get().runtimes[id];
      if (cur?.autonomous) {
        const done = cur.phases.length > 0 && cur.phases.every((p) => p.status === 'done');
        if (done || cur.autoTurns >= AUTO_MAX_TURNS) {
          get().stopAutonomous(id);
        } else {
          const timer = window.setTimeout(() => {
            const r = get().runtimes[id];
            if (r?.autonomous && !r.busy) {
              patch(id, { autoTurns: r.autoTurns + 1 });
              void runTurn(id, AUTO_INSTRUCTION);
            }
          }, 900);
          autoTimers.set(id, timer);
        }
      }
    }
  };

  return {
    runtimes: {},
    tabOrder: [],
    activeId: null,

    initStream: () => {
      if (streamUnlisten) return;
      streamUnlisten = () => {};
      void listen<CompanionStreamEvent>(COMPANION_STREAM_EVENT, (e) => {
        const ev = e.payload;
        const id = /^webbuild:(.+)$/.exec(ev.sessionId)?.[1];
        if (!id) return;
        const cur = get().runtimes[id];
        if (!cur) return;
        if (ev.kind === 'started') patch(id, { stream: '' });
        else if (ev.kind === 'cli') {
          const delta = extractAssistantTextDelta(ev.payload);
          if (delta) patch(id, { stream: cur.stream + delta });
        }
      }).then((un) => {
        streamUnlisten = un;
      });
    },

    setActive: (id) => set({ activeId: id }),

    setBuildSettings: (id, p) => patch(id, p),

    closeTab: (id) => {
      stopPoll(id);
      stopAuto(id);
      void webbuildDevStop(id).catch(() => {});
      set((s) => {
        const { [id]: _gone, ...rest } = s.runtimes;
        const order = s.tabOrder.filter((t) => t !== id);
        const activeId = s.activeId === id ? (order[order.length - 1] ?? null) : s.activeId;
        return { runtimes: rest, tabOrder: order, activeId };
      });
    },

    startExisting: async (id, name) => {
      ensure(id, name);
      await start(id);
    },

    createWithVision: async (name, vision) => {
      let project;
      try {
        project = await webbuildScaffold(name);
      } catch (e) {
        toastCatch('scaffold project')(e);
        return;
      }
      ensure(project.id, project.name);
      patch(project.id, {
        phases: MOCK_PHASES,
        seedPending: `Here's the project vision:\n\n${vision}\n\nPlan it out (emit your BUILD_PLAN), then start building — the foundation first, then the most important section. Keep me posted in a sentence or two.`,
      });
      await start(project.id);
    },

    reload: (id) => patch(id, { status: get().runtimes[id]?.status ?? null }),

    sendTurn: (id, text) => runTurn(id, text),

    startAutonomous: (id) => {
      const rt = get().runtimes[id];
      if (!rt || rt.busy || rt.autonomous) return;
      patch(id, { autonomous: true, resumeAuto: false, autoTurns: 0 });
      void runTurn(id, AUTO_INSTRUCTION);
    },

    stopAutonomous: (id) => {
      stopAuto(id);
      patch(id, { autonomous: false, resumeAuto: false });
    },

    stopTurn: (id) => {
      // Interrupt the running CLI turn now + halt any autonomous loop. The
      // pending runTurn resolves with whatever partial reply streamed and clears
      // `busy`; autonomous is already off so it won't chain another turn.
      stopAuto(id);
      patch(id, { autonomous: false, resumeAuto: false });
      void webbuildSessionStop(id).catch(() => {});
    },
  };
});

// Dev-only: expose the store so the test-automation bridge can drive Studio
// (create projects, answer questions, run autonomous) from `/eval`. Guarded by
// DEV so production never gets it.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __studioStore?: typeof useStudioStore }).__studioStore = useStudioStore;
}
