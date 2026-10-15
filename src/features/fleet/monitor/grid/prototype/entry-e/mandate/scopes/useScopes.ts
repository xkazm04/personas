// One mandate's Scopes section (`mandate_scopes`), re-read on every recorded
// act, and its two doors: widen (W) and narrow (N) through `mandate_amend`.
//
// A widen whose line arms (merge, spend, dispatch: the payload says) takes two
// presses: the first ARMS and the section lists what will no longer reach the
// operator; the second (W again, or Enter) amends; Escape disarms. Narrowing
// never arms: it only sends work back to the operator. An unsigned mandate
// cannot be amended, so both doors say so instead of writing.
//
// Loading pattern v2: `scopes` is null until the first read lands; a failed
// read is `failed` and keeps what was there.

import { useCallback, useEffect, useRef, useState } from 'react';
import { amendMandate, getMandateScopes } from '@/api/mandates';
import { useCharterActRecorded } from '@/features/decision-center/lanes/useLanesSnapshot';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateScopes } from '@/lib/bindings/MandateScopes';
import { isTauriError } from '@/lib/types/tauriError';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { ScopeLine, ScopeLineId } from './scopesModel';

export interface ScopesState {
  scopes: MandateScopes | null;
  failed: boolean;
  armed: ScopeLineId | null;
  notice: string | null;
  widen: (line: ScopeLine) => Promise<void>;
  narrow: (line: ScopeLine) => Promise<void>;
  disarm: () => void;
}

export function useScopes(charterId: string, onDone: () => void): ScopesState {
  const { t } = useTranslation();
  const m = t.monitor;
  const [scopes, setScopes] = useState<MandateScopes | null>(null);
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState<ScopeLineId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(() => {
    getMandateScopes(charterId)
      .then((s) => { if (alive.current) { setScopes(s); setFailed(false); } })
      .catch((err: unknown) => {
        silentCatch('fleet/mandates:scopes')(err);
        if (alive.current) setFailed(true);
      });
  }, [charterId]);
  useEffect(() => { setScopes(null); refresh(); }, [refresh]);
  useCharterActRecorded(refresh);

  const amend = useCallback(async (change: MandateChange) => {
    setArmed(null);
    setNotice(null);
    try {
      await amendMandate(charterId, change);
      refresh();
      onDone();
    } catch (err) {
      if (isTauriError(err) && err.kind === 'validation') { setNotice(err.error); return; }
      toastCatch('fleet/mandates:amend', m.ml_write_failed)(err);
    }
  }, [charterId, refresh, onDone, m]);

  const widen = useCallback(async (line: ScopeLine) => {
    if (!line.widen) { setNotice(m.ml_scopes_widen_none); return; }
    if (scopes && !scopes.signed) { setNotice(m.ml_scopes_sign_first); return; }
    if (line.arms && armed !== line.id) { setNotice(null); setArmed(line.id); return; }
    await amend(line.widen);
  }, [scopes, armed, amend, m]);

  const narrow = useCallback(async (line: ScopeLine) => {
    if (!line.narrow) { setNotice(m.ml_scopes_narrow_none); return; }
    if (scopes && !scopes.signed) { setNotice(m.ml_scopes_sign_first); return; }
    await amend(line.narrow);
  }, [scopes, amend, m]);

  return { scopes, failed, armed, notice, widen, narrow, disarm: useCallback(() => setArmed(null), []) };
}
