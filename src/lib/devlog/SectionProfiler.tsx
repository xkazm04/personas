import { Profiler, type ReactNode } from 'react';
import { onDevlogCommit } from './perf';

/**
 * Wraps the active sidebar section's content in a React Profiler that reports
 * slow commits (>= 50 ms) to devlog as `commit` records. DEV only: in a
 * production bundle `import.meta.env.DEV` folds to `false`, the Profiler
 * branch is dead code, and the children render bare.
 */
export function SectionProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!import.meta.env.DEV) return <>{children}</>;
  return (
    <Profiler id={id} onRender={onDevlogCommit}>
      {children}
    </Profiler>
  );
}
