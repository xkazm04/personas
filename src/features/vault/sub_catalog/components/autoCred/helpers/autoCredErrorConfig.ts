import { useRef, useEffect } from 'react';
import { XCircle, Clock, AlertTriangle, Wrench } from 'lucide-react';

// -- Error kind display config ----------------------------------------

export const ERROR_KIND_CONFIG: Record<string, { label: string; badgeClass: string; icon: typeof XCircle }> = {
  cli_not_found: { label: 'CLI Not Found', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
  spawn_failed: { label: 'Spawn Failed', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
  timeout: { label: 'Timeout', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: Clock },
  env_conflict: { label: 'Env Conflict', badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/25', icon: AlertTriangle },
  cli_error: { label: 'CLI Error', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: Wrench },
  extraction_failed: { label: 'Extraction Failed', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: AlertTriangle },
};

// -- Auto-scroll ref hook ---------------------------------------------

export function useAutoScrollRef(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  return ref;
}
