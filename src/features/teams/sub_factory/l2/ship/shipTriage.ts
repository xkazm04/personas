// Shared triage state for the Ship prototypes (hoisted in round 3 — both
// polished variants manipulate scope the same way): keyed bucket overrides on
// top of the mock milestone, so every move is instant, local, and reversible.
import { useMemo, useState } from 'react';

import type { ScopeBucket, ShipFeature, ShipMilestone } from './shipModel';

export interface ScopeTriage {
  /** Post-cut proposals still awaiting a bucket decision. */
  inbox: ShipFeature[];
  buckets: Record<ScopeBucket, ShipFeature[]>;
  bucketOf: (f: ShipFeature) => ScopeBucket;
  /** Re-bucket an already-triaged feature. */
  move: (id: string, b: ScopeBucket) => void;
  /** First-time triage of an inbox (post-cut) item. */
  triageNew: (id: string, b: ScopeBucket) => void;
}

export function useScopeTriage(m: ShipMilestone): ScopeTriage {
  const [moves, setMoves] = useState<Record<string, ScopeBucket>>({});
  const [triaged, setTriaged] = useState<Record<string, ScopeBucket>>({});

  const inbox = m.features.filter((f) => f.sinceCut && !triaged[f.id]);

  const buckets = useMemo(() => {
    const all = m.features.filter((f) => !f.sinceCut || triaged[f.id]);
    const of = (b: ScopeBucket) => all.filter((f) => (triaged[f.id] ?? moves[f.id] ?? f.bucket) === b);
    return { core: of('core'), later: of('later'), never: of('never') };
  }, [m.features, moves, triaged]);

  return {
    inbox,
    buckets,
    bucketOf: (f) => triaged[f.id] ?? moves[f.id] ?? f.bucket,
    move: (id, b) => setMoves((p) => ({ ...p, [id]: b })),
    triageNew: (id, b) => setTriaged((p) => ({ ...p, [id]: b })),
  };
}
