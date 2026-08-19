// The Skills "Overview" surface as a mountable component.
//
// It used to be inline in SkillsManagerPage — board, row derivation, adopt/
// share/use handlers and the two detail modals all wired together in the page
// body — which made it unreachable from anywhere else. The Mastermind canvas
// grew its own thinner skills UI as a result (a two-pane list+detail workbench
// that could adopt and dispatch but showed no coverage, memory binding, usage,
// or context picker). This is that surface as one component; the page and the
// canvas modal both mount it, so there is nothing left to develop twice.
//
// Requires an `ImproveProvider` above it. Both call sites already have one.
import { useState } from 'react';

import { SkillContextsModal } from './SkillContextsModal';
import { SkillInfoModal } from './SkillInfoModal';
import { SkillsManagerBoard } from './SkillsManagerBoard';
import { useSkillsManagerRows } from './skillsManagerRows';

export function SkillsOverviewPanel({ projectId }: { projectId: string | null }) {
  const rows = useSkillsManagerRows(projectId);
  const [contextsSkill, setContextsSkill] = useState<string | null>(null);
  const [infoSkill, setInfoSkill] = useState<string | null>(null);

  return (
    <>
      <SkillsManagerBoard
        ws={rows.ws}
        proj={rows.proj}
        library={rows.library}
        totalContexts={rows.totalContexts}
        busy={rows.busy}
        projectName={rows.projectName}
        projectId={projectId}
        onAdopt={rows.onAdopt}
        onShare={rows.onShare}
        onUse={rows.onUse}
        onSwitchMemory={rows.onSwitchMemory}
        onOpenContexts={setContextsSkill}
        onOpenInfo={setInfoSkill}
      />

      {contextsSkill && projectId && (
        <SkillContextsModal
          projectId={projectId}
          projectName={rows.projectName}
          skill={contextsSkill}
          totalContexts={rows.totalContexts}
          onClose={() => setContextsSkill(null)}
        />
      )}
      {infoSkill && (
        <SkillInfoModal skillName={infoSkill} projectId={projectId} onClose={() => setInfoSkill(null)} />
      )}
    </>
  );
}
