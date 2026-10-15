// What every panel of the sheet reads. One value, built once per render by useSheetController; the panels take
// what they show from it and call the verbs on it. No panel touches the engine or the source directly.
import { createContext, useContext, type Dispatch } from 'react';
import type { Engine } from '../engine/Engine';
import type { EngineWords } from '../engine/types';
import type { Plan } from '../model/plan';
import type { Scope } from '../model/scope';
import type { Work, WorkItem } from '../model/work';
import type { BlueprintActions, BlueprintData } from '../source';
import type { UiAction, UiState } from '../state/uiState';
import type { ViewStore } from '../state/viewStore';
import type { BlueprintText } from './useBlueprintText';
import type { Nav } from './useNavigation';
import type { Writes } from './useWrites';

export interface Sheet {
  data: BlueprintData;
  /** The seam's side reads (a commit's diff, a shot's URL) for the compare panel; every WRITE goes through `writes`. */
  actions: BlueprintActions;
  plan: Plan;
  work: Work;
  ui: UiState;
  dispatch: Dispatch<UiAction>;
  engine: Engine | null;
  view: ViewStore;
  text: BlueprintText;
  words: EngineWords;
  scope: Scope;
  /** The Build queue in the current scope and sheet. */
  queue: WorkItem[];
  /** Every queued item of the lens sheet, whatever the scope (the count the title block shows). */
  queueAll: WorkItem[];
  current: WorkItem | null;
  nav: Nav;
  writes: Writes;
  onClose(): void;
}

export const SheetContext = createContext<Sheet | null>(null);

export function useSheet(): Sheet {
  const s = useContext(SheetContext);
  if (!s) throw new Error('useSheet: no BlueprintSheet above');
  return s;
}
