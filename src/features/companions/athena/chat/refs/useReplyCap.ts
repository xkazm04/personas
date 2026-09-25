/**
 * The effective layer-one cap for the display fold: the register's `default`
 * row, or the base register (3) when there is none or the read fails.
 *
 * Topic overrides are not applied here: the frontend cannot tell which topic a
 * reply belongs to, and the fold is a safety net, not the register itself.
 *
 * One fetch per minute at most, shared across every bubble via a one-entry
 * `createModuleCache` with a TTL.
 */

import { useEffect, useState } from 'react';
import { companionListReplyRegister } from '@/api/companion';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { silentCatch } from '@/lib/silentCatch';
import { BASE_REPLY_SENTENCES } from './replyFold';

const STALE_MS = 60_000;
const capStore = createModuleCache<'cap', number>({ ttlMs: STALE_MS, maxSize: 1 });
let inflight: Promise<number> | null = null;

function loadCap(): Promise<number> {
  if (inflight) return inflight;
  inflight = companionListReplyRegister()
    .then((rows) => {
      const row = rows.find((r) => r.scope === 'default');
      return row && row.sentences >= 1 ? row.sentences : BASE_REPLY_SENTENCES;
    })
    .catch((err: unknown) => {
      silentCatch('companion_list_reply_register')(err);
      return BASE_REPLY_SENTENCES;
    })
    .then((cap) => {
      capStore.set('cap', cap);
      inflight = null;
      capStore.notify();
      return cap;
    });
  return inflight;
}

export function useReplyCap(): number {
  const [cap, setCap] = useState(() => capStore.get('cap') ?? BASE_REPLY_SENTENCES);
  useEffect(() => {
    const off = capStore.subscribe(() => setCap(capStore.get('cap') ?? BASE_REPLY_SENTENCES));
    if (!capStore.has('cap')) void loadCap();
    return off;
  }, []);
  return cap;
}

/** Test hatch: forget the cached cap. */
export function __resetReplyCapForTests(): void {
  capStore.clear();
  inflight = null;
}
