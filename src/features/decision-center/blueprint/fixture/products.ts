// The project switcher's list for the fixture (spark bp-fidelity, Stage A): the Kettle sample plus three INVENTED
// products, one per readiness level, so every LevelIcon shape is drawn. The Personas repo is public: none of these
// names is a real project, and none carries a path.
import type { BlueprintProductEntry } from '../source';

export const FIXTURE_PRODUCTS: readonly BlueprintProductEntry[] = [
  { projectId: 'fixture-kettle', name: 'Kettle', level: 'full', proposals: 8, lastRunAt: '2026-10-15T10:48:00.000Z' },
  { projectId: 'fixture-lantern', name: 'Lantern Rota', level: 'measured', proposals: 3, lastRunAt: '2026-10-12T09:30:00.000Z' },
  { projectId: 'fixture-quill', name: 'Quill Ledger', level: 'map-only', proposals: 0 },
  { projectId: 'fixture-harbor', name: 'Harbor Notes', level: 'missing', proposals: 0, error: 'app-structure.json is not readable' },
];
