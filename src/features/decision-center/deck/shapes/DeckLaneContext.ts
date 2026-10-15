/**
 * What the lane-shaped cards read besides the item: the lanes join, the
 * mandates (`mandate_list`) and the snapshot's per-charter counts. Provided
 * once by the deck host; a deck without lanes reads the empty value and every
 * card keeps its default shape.
 */
import { createContext, useContext } from 'react';
import type { LaneCharter } from '@/lib/bindings/LaneCharter';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { LaneIndex } from '../../lanes/laneModel';

export interface DeckLaneData {
  lanes: LaneIndex;
  /** By charter id. */
  mandates: ReadonlyMap<string, MandateSummary>;
  /** By charter id: status, version and the items held on it. */
  charters: ReadonlyMap<string, LaneCharter>;
}

const EMPTY: DeckLaneData = { lanes: new Map(), mandates: new Map(), charters: new Map() };

export const DeckLaneContext = createContext<DeckLaneData>(EMPTY);

export function useDeckLanes(): DeckLaneData {
  return useContext(DeckLaneContext);
}
