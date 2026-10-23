import { useRef, useEffect } from 'react';
import { XCircle, Clock, AlertTriangle, Wrench } from 'lucide-react';

// -- Error kind display config ----------------------------------------

/** Key into `t.vault.auto_cred_extra`, resolved at render. */
export type ErrorKindLabelKey = 'err_kind_cli_not_found' | 'err_kind_spawn_failed' | 'err_kind_timeout' | 'err_kind_env_conflict' | 'err_kind_cli_error' | 'err_kind_extraction_failed';

export const ERROR_KIND_CONFIG: Record<string, { labelKey: ErrorKindLabelKey; badgeClass: string; icon: typeof XCircle }> = {
  cli_not_found: { labelKey: 'err_kind_cli_not_found', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
  spawn_failed: { labelKey: 'err_kind_spawn_failed', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
  timeout: { labelKey: 'err_kind_timeout', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: Clock },
  env_conflict: { labelKey: 'err_kind_env_conflict', badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/25', icon: AlertTriangle },
  cli_error: { labelKey: 'err_kind_cli_error', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: Wrench },
  extraction_failed: { labelKey: 'err_kind_extraction_failed', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: AlertTriangle },
};

// -- Auto-scroll ref hook ---------------------------------------------

export function useAutoScrollRef(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  return ref;
}
