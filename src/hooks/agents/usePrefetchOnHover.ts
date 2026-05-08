import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { silentCatch } from "@/lib/silentCatch";

const DEFAULT_INTENT_DELAY_MS = 120;

export function usePrefetchOnHover(delayMs = DEFAULT_INTENT_DELAY_MS) {
  const prefetchPersona = useAgentStore((s) => s.prefetchPersona);
  const activeRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    controller: AbortController;
  } | null>(null);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    active.controller.abort();
    activeRef.current = null;
  }, []);

  const schedule = useCallback(
    (personaId: string) => {
      cancel();
      const controller = new AbortController();
      const timer = setTimeout(() => {
        activeRef.current = { timer: null, controller };
        prefetchPersona(personaId, controller.signal).catch(
          silentCatch(`usePrefetchOnHover:${personaId}`),
        );
      }, delayMs);
      activeRef.current = { timer, controller };
    },
    [cancel, delayMs, prefetchPersona],
  );

  useEffect(() => cancel, [cancel]);

  return useMemo(
    () => ({
      getPrefetchProps: (personaId: string) => ({
        onMouseEnter: () => schedule(personaId),
        onMouseLeave: cancel,
        onFocus: () => schedule(personaId),
        onBlur: cancel,
      }),
    }),
    [cancel, schedule],
  );
}
