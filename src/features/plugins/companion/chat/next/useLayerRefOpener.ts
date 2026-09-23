/**
 * The prototypes' `openRef` overrides: approval / card / decision links open
 * the matching work item in layer two, and a report opens as the layer-two
 * `report` view. A decision handle may name a card row rather than the pending
 * decision (the dispatcher treats them alike), so a miss retries as a card and
 * finally opens the deck unfocused rather than doing nothing.
 */

import { useMemo } from 'react';
import type { RefOpenerOverrides } from '../refs/openRef';
import type { LayerApi } from './useLayer';
import type { WorkItem } from './useWorkforce';

export function useLayerRefOpener(layer: LayerApi, items: WorkItem[]): RefOpenerOverrides {
  const { openWork, openReport } = layer;
  return useMemo<RefOpenerOverrides>(
    () => ({
      openWork: (workItemId) => {
        const ids = new Set(items.map((i) => i.id));
        const handle = workItemId.slice(workItemId.indexOf(':') + 1);
        const focus = ids.has(workItemId) ? workItemId : ids.has(`card:${handle}`) ? `card:${handle}` : null;
        openWork(focus, null);
      },
      openReport,
    }),
    [items, openWork, openReport],
  );
}
