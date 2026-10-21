// The four sources the page reaches OUTSIDE the overview pipeline: the
// attention loop, the scheduled triggers, the vault audit log and the
// self-healing effectiveness ledger. Each was fetched by its own card on the
// old page; layer 1 needs their headline, so each is read here once, on its
// own clock, into its own Reading. Law 6 (docs/design/overview-loading.md):
// every source settles its own reading - none waits on another.

import { useEffect, useState } from 'react';
import { getAttentionLoopStatus } from '@/api/agents/personaBrain';
import { listAllTriggers } from '@/api/pipeline/triggers';
import { getCredentialAuditLogGlobal, type CredentialAuditEntry } from '@/api/vault/credentials';
import { getHealingEffectiveness, type HealingEffectivenessReport } from '@/api/overview/healing';
import { silentCatch, extractMessage } from '@/lib/silentCatch';
import type { AttentionLoopStatus } from '@/lib/bindings/AttentionLoopStatus';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { TriggerKind } from '@/lib/bindings/TriggerKind';
import type { Reading } from './readings';

const REFRESH_MS = 60_000;
/** Same window VaultActivityCard reads. */
const AUDIT_LIMIT = 40;

function useSource<T>(label: string, load: () => Promise<T>): Reading<T> {
  const [reading, setReading] = useState<Reading<T>>({ status: 'pending' });
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (document.hidden) return;
      load()
        .then((value) => { if (alive) setReading({ status: 'ready', value }); })
        .catch((err: unknown) => {
          silentCatch(`missionControl/${label}`)(err);
          // A failed refresh never hides a reading already on screen (law 1).
          if (alive) setReading((prev) => (prev.status === 'ready' ? prev : { status: 'failed', error: extractMessage(err) }));
        });
    };
    run();
    const id = window.setInterval(run, REFRESH_MS);
    return () => { alive = false; window.clearInterval(id); };
    // `load` is a module-level function per call site; the label pins identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);
  return reading;
}

const loadLoop = () => getAttentionLoopStatus();
const loadTriggers = () => listAllTriggers();
const loadAudit = () => getCredentialAuditLogGlobal(AUDIT_LIMIT);
const loadHealing = () => getHealingEffectiveness();

export interface SideReadings {
  loop: Reading<AttentionLoopStatus>;
  triggers: Reading<PersonaTrigger[]>;
  audit: Reading<CredentialAuditEntry[]>;
  healing: Reading<HealingEffectivenessReport>;
}

export function useSideReadings(): SideReadings {
  return {
    loop: useSource('loop', loadLoop),
    triggers: useSource('triggers', loadTriggers),
    audit: useSource('audit', loadAudit),
    healing: useSource('healing', loadHealing),
  };
}

/** Clock-driven trigger kinds: the ones with a `next_trigger_at`, read by the
 *  routines card and the mission readings. Typed against the ts-rs
 *  `TriggerKind` union so a spelling the schema cannot store fails tsc (the
 *  hand-typed copies listed 'cron', which `TriggerKind` does not have). */
const SCHEDULE_TRIGGER_KINDS: readonly TriggerKind[] = ['schedule', 'polling'];
export const SCHEDULE_TRIGGER_TYPES: ReadonlySet<string> = new Set(SCHEDULE_TRIGGER_KINDS);
