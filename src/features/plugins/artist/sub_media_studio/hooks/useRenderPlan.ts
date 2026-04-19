import { useEffect, useMemo, useRef, useState } from 'react';
import { artistCompileRenderPlan } from '@/api/artist';
import { silentCatch } from '@/lib/silentCatch';
import type { RenderPlan } from '@/lib/bindings/RenderPlan';
import type { Composition } from '../types';

/** Short enough to feel instant, long enough to collapse a drag-storm. */
const COMPILE_DEBOUNCE_MS = 40;

export interface RenderPlanState {
  /** Latest successfully compiled plan (null until first compile settles). */
  plan: RenderPlan | null;
  /** True while an IPC compile is in flight. */
  compiling: boolean;
}

/**
 * Compile the Composition into the RenderPlan IR via the canonical Rust
 * compiler (Tauri IPC). One implementation across preview and export.
 *
 * The hook is shared by MediaStudioPage so both the toolbar (to show
 * compile warnings) and the preview (to render stages) consume the same
 * plan. Debounced and sequence-guarded so drag storms collapse into a
 * single round-trip and out-of-order responses can't replace a newer
 * plan with an older one.
 */
export function useRenderPlan(composition: Composition): RenderPlanState {
  const compositionJson = useMemo(() => JSON.stringify(composition), [composition]);
  const [plan, setPlan] = useState<RenderPlan | null>(null);
  const [compiling, setCompiling] = useState(false);
  const compileSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++compileSeqRef.current;
    const handle = window.setTimeout(() => {
      setCompiling(true);
      artistCompileRenderPlan(compositionJson)
        .then((next) => {
          if (seq === compileSeqRef.current) {
            setPlan(next);
            setCompiling(false);
          }
        })
        // An in-progress edit can briefly violate compile invariants
        // (zero-duration drag, out-of-range trim). Keep the last valid
        // plan on screen until the edit settles.
        .catch((err: unknown) => {
          if (seq === compileSeqRef.current) setCompiling(false);
          silentCatch('render_plan_compile')(err);
        });
    }, COMPILE_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [compositionJson]);

  return { plan, compiling };
}
