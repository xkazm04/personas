// PROTOTYPE ROUND (spark council-readout). English-only copy shared by the
// prototype chrome. Each variant keeps its own words in a `const S` at the
// top of its file; consolidation moves the winner's into `t.council` with
// all 14 locales and deletes this file.
import type { PageVariant, PanelVariant } from './protoVariant';
import type { QueueFilter } from './protoModel';

export const PROTO = {
  filter: { waiting: 'Waiting on you', machine: 'Machine pass', decided: 'Decided' } satisfies Record<QueueFilter, string>,
  panelVariant: {
    current: 'Current',
    ledger: 'Ledger strip',
    cards: 'Scorecards',
    table: 'Bullet table',
    lanes: 'Project lanes',
  } satisfies Record<PanelVariant, string>,
  pageVariant: {
    current: 'Current',
    dossier: 'Dossier',
    scoreboard: 'Scoreboard',
    findings: 'Findings board',
    hybrid: 'Hybrid',
  } satisfies Record<PageVariant, string>,
  panelSwitch: 'Panel prototype',
  pageSwitch: 'Council prototype',
  openCouncil: 'Open council',
  runFullCouncil: 'Run full council',
  back: 'Back to the galaxy',
  lite: 'Lite round only',
  loading: 'Reading the council',
  readFailed: 'This round could not be read.',
  retry: 'Try again',
  empty: 'Nothing here.',
};
