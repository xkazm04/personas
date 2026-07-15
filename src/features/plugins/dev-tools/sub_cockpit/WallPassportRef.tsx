// WALL VARIANT 1 — "Passport (ref)". The PRODUCTION Factory Passport Wall,
// embedded unmodified over the same three mock passports the new variants read.
// This is the R7 reference point: same data, same rows — so any visual verdict
// is about the paint, never the content. Improve/scan affordances render but
// have no engine behind them here (useImprove() → null is a supported state).
import { ProjectsPassportWall } from '@/features/teams/sub_factory/passport/ProjectsPassportWall';

import { MOCK_PASSPORTS } from './wallMock';

const OPEN_SLUGS = new Set(MOCK_PASSPORTS.map((p) => p.identity.slug));

export default function WallPassportRef({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-8" data-testid="wall-passport-ref">
      <ProjectsPassportWall
        passports={MOCK_PASSPORTS}
        openSlugs={OPEN_SLUGS}
        onOpen={onOpenProject}
      />
    </div>
  );
}
