import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LangfuseStackDone } from "@/lib/bindings/LangfuseStackDone";
import type { LangfuseStackProgress } from "@/lib/bindings/LangfuseStackProgress";
import { useLangfuseStackStore } from "@/stores/langfuseStackStore";

/**
 * Global subscriber for Langfuse stack lifecycle events. Mount once at app
 * startup so progress survives navigation away from the plugin page —
 * a long stack start can complete while the user is on a different screen,
 * and the OS notification + lastOutcome banner do the rest.
 */
export function useLangfuseStackEvents(): void {
  const onProgress = useLangfuseStackStore((s) => s.onProgress);
  const onDone = useLangfuseStackStore((s) => s.onDone);

  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;

    void listen<LangfuseStackProgress>("langfuse://stack/progress", (event) => {
      onProgress(event.payload);
    }).then((fn) => {
      unlistenProgress = fn;
    });

    void listen<LangfuseStackDone>("langfuse://stack/done", (event) => {
      onDone(event.payload);
    }).then((fn) => {
      unlistenDone = fn;
    });

    return () => {
      unlistenProgress?.();
      unlistenDone?.();
    };
  }, [onProgress, onDone]);
}
