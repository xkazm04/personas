// The mandate page's three writes, each reporting what happened in place:
// Suspend / Resume, revert the selected act, narrow its scope. A refusal is
// not a crash: `forbidden` (an irreversible act) and `validation` (already
// reverted or superseded) become the page's notice; anything else toasts.

import { useCallback, useState } from 'react';
import { amendMandate, resumeMandate, revertCharterAct, suspendMandate } from '@/api/mandates';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { isTauriError } from '@/lib/types/tauriError';
import { toastCatch } from '@/lib/silentCatch';
import { canRevert, narrowableScope } from './MandateRail';

export function useMandateDoors(mandate: MandateSummary | null, act: CharterAct | null, onDone: () => void) {
  const { t } = useTranslation();
  const m = t.monitor;
  const [notice, setNotice] = useState<string | null>(null);

  const refused = useCallback((err: unknown) => {
    if (isTauriError(err) && err.kind === 'forbidden') { setNotice(m.ml_revert_final); return; }
    if (isTauriError(err) && err.kind === 'validation') { setNotice(err.error); return; }
    toastCatch('fleet/mandates:write', m.ml_write_failed)(err);
  }, [m]);

  const suspend = useCallback(async () => {
    if (!mandate) return;
    setNotice(null);
    try {
      if (mandate.status === 'suspended') await resumeMandate(mandate.charterId);
      else await suspendMandate(mandate.charterId);
      onDone();
    } catch (err) { refused(err); }
  }, [mandate, onDone, refused]);

  const revert = useCallback(async () => {
    if (!act) return;
    if (!canRevert(act)) {
      setNotice(act.revertedAt ? m.ml_revert_already : act.itemKind === 'act.revert' ? m.ml_revert_is_revert : m.ml_revert_final);
      return;
    }
    setNotice(null);
    try {
      await revertCharterAct(act.id);
      onDone();
    } catch (err) { refused(err); }
  }, [act, onDone, refused, m]);

  const narrow = useCallback(async () => {
    if (!mandate) return;
    const scope = narrowableScope(mandate, act);
    if (!scope) return;
    setNotice(null);
    try {
      await amendMandate(mandate.charterId, { kind: 'narrowScope', scopes: [scope] });
      onDone();
    } catch (err) { refused(err); }
  }, [mandate, act, onDone, refused]);

  return { notice, setNotice, suspend, revert, narrow };
}
