/**
 * The join the findings loop was missing on this side.
 *
 * `emitSkillDormantFindings` has ranked installed-but-never-invoked skills
 * since Phase 2 and written them into `dev_ideas` with `origin = 'skill_dormant'`.
 * Skills Overview - the surface that owns those exact skills - never read them,
 * so the sensor kept filing into a parallel inbox the library could not see.
 * Technique `finding-lifecycle`: the queue should BE the library's recommended
 * set, not a second list of the same names somewhere else.
 *
 * The parse is deliberately defensive about two things a persisted blob can do
 * that a fresh draft cannot:
 *  - `evidence` is a TEXT column, so it can be null, malformed, or from an older
 *    emitter shape. A finding we cannot name a skill for is DROPPED, never shown
 *    with a blank name - a recommendation without a subject is noise.
 *  - `status` is the authority. Only `pending` findings are recommendations; a
 *    dismissed or dispatched one has already been decided.
 */

import { useCallback, useEffect, useState } from 'react';
import { listIdeas } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import type { DevIdea } from '@/lib/bindings/DevIdea';

export const DORMANT_ORIGIN = 'skill_dormant';

export interface DormantSkillFinding {
  ideaId: string;
  skillName: string;
  /** 'project' | 'global' as the emitter recorded it; null on an older row. */
  scope: string | null;
  /** ISO timestamp, or null for "never invoked" - which is NOT the same claim. */
  lastInvokedAt: string | null;
}

/** Narrow one `evidence` blob to the fields the strip renders. */
function readEvidence(raw: string | null): { skillName?: unknown; scope?: unknown; lastInvokedAt?: unknown } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // The invariant: `evidence` is the emitter's own object, written by
    // `JSON.stringify(d.evidence)` in the sweep's persist step. Anything else on
    // this column is an older shape or hand-edited, and is treated as unusable
    // rather than coerced.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as { skillName?: unknown; scope?: unknown; lastInvokedAt?: unknown };
  } catch {
    // A malformed blob is a finding we cannot name a skill for. Dropping it is
    // the honest outcome; showing a nameless row would not be.
    return null;
  }
}

/** Pending dormant-skill findings, newest-first order preserved from the caller. */
export function parseDormantFindings(ideas: DevIdea[]): DormantSkillFinding[] {
  const out: DormantSkillFinding[] = [];
  const seen = new Set<string>();
  for (const idea of ideas) {
    if (idea.origin !== DORMANT_ORIGIN) continue;
    if (idea.status !== 'pending') continue;
    const ev = readEvidence(idea.evidence);
    const name = typeof ev?.skillName === 'string' ? ev.skillName : null;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      ideaId: idea.id,
      skillName: name,
      scope: typeof ev?.scope === 'string' ? ev.scope : null,
      lastInvokedAt: typeof ev?.lastInvokedAt === 'string' ? ev.lastInvokedAt : null,
    });
  }
  return out;
}

export function useDormantSkillFindings(projectId: string | null): {
  findings: DormantSkillFinding[];
  refresh: () => void;
} {
  const [findings, setFindings] = useState<DormantSkillFinding[]>([]);
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setFindings([]);
      return;
    }
    let cancelled = false;
    listIdeas(projectId, 'pending')
      .then((ideas) => {
        if (cancelled) return;
        setFindings(parseDormantFindings(ideas));
      })
      .catch((err: unknown) => {
        // A failed read must not invent an empty recommendation set that reads
        // as "nothing dormant" - the strip simply does not render.
        silentCatch('useDormantSkillFindings:listIdeas')(err);
        if (!cancelled) setFindings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, token]);

  return { findings, refresh };
}
