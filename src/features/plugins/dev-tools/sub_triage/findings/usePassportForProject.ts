// One project's passport, derived from the cached cross-project scan.
//
// The Factory route builds passports for the whole fleet through a React context;
// the Triage route only needs ONE, and only to give the standards emitter the
// stack line for its fix prompts. So we read the cached scan directly rather than
// hoisting Factory's provider up the tree. Returns null when the project has
// never been scanned — the sweep then skips the passport sensors and says so.
import { useEffect, useState } from 'react';

import { getCrossProjectMetadata, listProjects } from '@/api/devTools/devTools';
import { derivePassportFromMetadata } from '@/features/teams/sub_factory/passport/passportDerive';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';
import { silentCatch } from '@/lib/silentCatch';

export function usePassportForProject(projectId: string | null): AppPassport | null {
  const [passport, setPassport] = useState<AppPassport | null>(null);

  useEffect(() => {
    if (!projectId) {
      setPassport(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [projects, meta] = await Promise.all([listProjects(), getCrossProjectMetadata()]);
        const project = projects.find((p) => p.id === projectId);
        const projectMeta = meta?.projects?.find((m) => m.project_id === projectId);
        if (!project || !projectMeta) {
          if (!cancelled) setPassport(null);
          return;
        }
        const derived = derivePassportFromMetadata(projectMeta, project);
        if (!cancelled) setPassport(derived);
      } catch (e) {
        silentCatch('findings/usePassportForProject')(e);
        if (!cancelled) setPassport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return passport;
}
