import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOverviewStore } from '@/stores/overviewStore';

/**
 * Subscribes to the certification slice and kicks off the initial load,
 * deferred to idle so navigating into the Overview → Certification tab never
 * blocks the main thread. Mirrors the deferred-load pattern in
 * PersonaHealthDashboard.
 */
export function useCertificationData() {
  const data = useOverviewStore(
    useShallow((s) => ({
      evalRuns: s.evalRuns,
      certStatus: s.certStatus,
      evalRunDetail: s.evalRunDetail,
      certLoading: s.certLoading,
      certDetailLoading: s.certDetailLoading,
      certError: s.certError,
      certLastRefreshedAt: s.certLastRefreshedAt,
      refreshCertification: s.refreshCertification,
      loadEvalRunDetail: s.loadEvalRunDetail,
      clearEvalRunDetail: s.clearEvalRunDetail,
    })),
  );

  const { certStatus, evalRuns, certLoading, certLastRefreshedAt, refreshCertification } = data;

  useEffect(() => {
    // Already loaded or in flight — don't re-fetch on every mount.
    if (certLastRefreshedAt || certLoading || certStatus.length > 0 || evalRuns.length > 0) return;

    const run = () => void refreshCertification();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const tmo = setTimeout(run, 200);
    return () => clearTimeout(tmo);
  }, [certStatus.length, evalRuns.length, certLoading, certLastRefreshedAt, refreshCertification]);

  return data;
}
