import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStudioStore } from '../studioStore';

// The fields the Guide layout renders, shallow-selected: the runtime object is
// replaced on every stream delta, and `stream` is deliberately left out so a
// streaming reply does not re-render the whole layout per token.
export function useGuideRuntime() {
  return useStudioStore(
    useShallow((s) => {
      const r = s.activeId ? s.runtimes[s.activeId] : undefined;
      if (!r) return undefined;
      return {
        id: r.id,
        name: r.name,
        phase: r.phase,
        healthy: !!r.status?.healthy,
        phases: r.phases,
        busy: r.busy,
        autonomous: r.autonomous,
        autoTurns: r.autoTurns,
        question: r.question,
        options: r.options,
        decisionSelector: r.decisionSelector,
        messages: r.messages,
        activity: r.activity,
        turnStartedAt: r.turnStartedAt,
        turnDurations: r.turnDurations,
        queuedNotes: r.queuedNotes,
        mcp: r.mcp,
        sketch: r.sketch,
        sketchState: r.sketchState,
        sketchAnswers: r.sketchAnswers,
        setupStartedAt: r.setupStartedAt,
      };
    }),
  );
}

export type GuideRuntime = NonNullable<ReturnType<typeof useGuideRuntime>>;

/** Seconds since `since`, ticking once a second while `since` is set. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/** 372 -> "6:12" */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
