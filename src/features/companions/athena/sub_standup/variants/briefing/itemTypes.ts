import type { StandupView } from '../../model/types';
import type { StandupController } from '../types';
import type { BriefingApi, DocEntry } from './useBriefing';

/** What every item of the briefing reads besides its own row. */
export interface ItemCtx {
  view: StandupView;
  c: StandupController;
  api: BriefingApi;
  /** The standup is a draft: picks, skips and undos apply. */
  editable: boolean;
  proposing: boolean;
}

export interface ItemProps {
  entry: DocEntry;
  ctx: ItemCtx;
}
