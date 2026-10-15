/**
 * useRefusalClasses — a charter's refusal classes (the mandate's "forbidden
 * classes"), which `mandate_list` does not carry. Read from the steward's
 * charters (`list_persona_responsibilities`, drafts included) once per card.
 *
 * `null` while reading, `'failed'` when the read failed or the charter is not
 * among the steward's (never shown as "none").
 */
import { useEffect, useState } from 'react';

import { listPersonaResponsibilities } from '@/api/agents/responsibilities';
import { silentCatch } from '@/lib/silentCatch';

export type RefusalClasses = readonly string[] | 'failed' | null;

export function useRefusalClasses(charterId: string | null, personaId: string | null): RefusalClasses {
  const [classes, setClasses] = useState<RefusalClasses>(null);
  useEffect(() => {
    setClasses(null);
    if (!charterId || !personaId) return;
    let live = true;
    listPersonaResponsibilities(personaId)
      .then((rows) => {
        const row = rows.find((r) => r.id === charterId);
        if (live) setClasses(row ? row.refusalClasses : 'failed');
      })
      .catch((err: unknown) => {
        silentCatch('decisionCenter.refusalClasses')(err);
        if (live) setClasses('failed');
      });
    return () => { live = false; };
  }, [charterId, personaId]);
  return classes;
}
