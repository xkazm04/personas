/**
 * Curator's standing settings, read as one typed value and written one key at
 * a time through the app's own settings door.
 *
 * Two reads, settled independently: the POLICY is what the operator declared
 * (nullable caps, because an undeclared cap is not a cap of zero) and the
 * RUNTIME is what has been spent against it today. Either can fail without the
 * other going dark, and a failed read leaves its field null - which the
 * surface renders as unknown rather than as nothing consumed.
 *
 * Every write goes through `set_app_setting`, which carries the allow-list, the
 * validator, the audit row and the change broadcast. There is no second setter,
 * and a refusal is surfaced rather than swallowed: the whole point of the Rust
 * validator is that an out-of-range cap does not silently "not take".
 */
import { useCallback, useEffect, useState } from 'react';

import { curatorPolicyGet, curatorRuntimeGet } from '@/api/curator';
import { setAppSetting } from '@/api/system/settings';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export interface CuratorPolicyState {
  policy: CuratorPolicy | null;
  runtime: CuratorRuntime | null;
  loading: boolean;
  /** Write one key, then re-read so the screen shows the backend's own truth. */
  write: (key: string, value: string) => Promise<void>;
}

export function useCuratorPolicy(): CuratorPolicyState {
  const [policy, setPolicy] = useState<CuratorPolicy | null>(null);
  const [runtime, setRuntime] = useState<CuratorRuntime | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [p, r] = await Promise.allSettled([curatorPolicyGet(), curatorRuntimeGet()]);
    if (p.status === 'fulfilled') setPolicy(p.value);
    else silentCatch('curator:setup:policy')(p.reason);
    if (r.status === 'fulfilled') setRuntime(r.value);
    else silentCatch('curator:setup:runtime')(r.reason);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const write = useCallback(
    async (key: string, value: string) => {
      try {
        await setAppSetting(key, value);
      } catch (err) {
        // A refused write is the operator's own act failing, so it is a toast.
        toastCatch(`curator:setup:${key}`)(err);
      }
      // Re-read either way. After a refusal the field must snap back to what
      // is actually stored rather than keep showing a value nothing accepted.
      await reload();
    },
    [reload],
  );

  return { policy, runtime, loading, write };
}
