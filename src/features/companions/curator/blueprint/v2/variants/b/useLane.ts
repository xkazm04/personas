/**
 * ONE hook, so the day the event lands the swap is one file.
 *
 * The brief is explicit: state must ARRIVE, not be asked for, and no polling
 * loop dressed as a stopgap. There is no `curator://request-changed` event yet
 * - but `companions://status-changed` exists and Rust already publishes to it
 * through `eventRegistry`, and `createSingletonListener` is the app's own way
 * of holding exactly one Tauri listener however many surfaces are mounted.
 *
 * So this hook is shaped as the final one already: it owns the lane, it
 * re-reads on a push, and it never sets a timer. Today `read` resolves the
 * local fixture because `curator_request` has no rows and the prototype must
 * draw something; the production version replaces that one function with
 * `curatorRequestsList()` and narrows the listener to the curator event. No
 * component below this file knows which of the two it is talking to.
 *
 * `null` is preserved end to end and is NOT an empty lane: it is a door that
 * did not answer, and the column draws it as unknown rather than as nothing
 * filed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { COMPANIONS_STATUS_EVENT } from '@/api/companions';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { silentCatch } from '@/lib/silentCatch';

import type { Intake } from './fixture';

/** One listener for the whole app, whatever else is mounted beside this page. */
const onCompanionsChanged = createSingletonListener<unknown>(COMPANIONS_STATUS_EVENT);

export interface Lane {
  /** The operator's lane, newest last. `null` = the door did not answer. */
  intakes: Intake[] | null;
  /** True until the first read settles, so the column can hold its chrome. */
  loading: boolean;
}

/**
 * @param read what the lane currently is. A promise, so the production swap is
 *   `curatorRequestsList` without changing this file's shape.
 */
export function useLane(read: () => Promise<Intake[] | null>): Lane {
  const [intakes, setIntakes] = useState<Intake[] | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(read);
  live.current = read;

  const reload = useCallback(() => {
    void (async () => {
      try {
        setIntakes(await live.current());
      } catch (err) {
        // A refused read leaves the lane NULL rather than empty: "nothing is
        // filed" and "nobody could ask" are the two facts this column most
        // needs to keep apart, and collapsing them here would make every
        // careful ink below it a lie.
        setIntakes(null);
        silentCatch('curator:blueprint:v2b:lane')(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    reload();
  }, [reload, read]);

  // The push seam. A payload means something in companion-land moved; the lane
  // is re-read rather than patched, because a diff applied to a list the
  // backend owns is a second source of truth.
  onCompanionsChanged(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { intakes, loading };
}
