/**
 * The Lifecycle page body: the action row (Install, Ask Athena, the inline
 * install result and the load-failure banner) above ONE of two layers:
 *
 * - Layer 1 (`layer1/Layer1`): the whole practice as the collar rail;
 * - Layer 2 (`layer2/StepScreen`): one step's own screen, when a key was
 *   pressed. It replaces Layer 1 in place; the page does not navigate.
 *
 * Returning from Layer 2 puts focus back on the key of the step that was
 * open, so a keyboard reader lands where they left. Cold load ghosts the rail
 * under the permanent action row (loading pattern v2).
 */
import { useEffect, useRef } from 'react';

import { KitHost } from '@/features/shared/components/kit';

import { JourneyGhost } from '../journey/JourneyGhost';
import { LifecycleActions } from './blocks/LifecycleActions';
import { useLifecycleViewModel } from './context';
import { Layer1 } from './layer1/Layer1';
import { StepScreen } from './layer2/StepScreen';
import './layer1/layer1.css';

/** Scroll the page's own scroll region back to its top, so a step's screen opens at its head. */
function scrollRegionToTop(el: HTMLElement | null) {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0;
      return;
    }
  }
}

export function LifecycleBody() {
  const { order, loading, openStepId } = useLifecycleViewModel();
  const open = openStepId ? order.find((n) => n.id === openStepId) ?? null : null;
  const hostRef = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      if (!lastOpen.current) scrollRegionToTop(hostRef.current);
      lastOpen.current = open.id;
      return;
    }
    const back = lastOpen.current;
    lastOpen.current = null;
    if (back) hostRef.current?.querySelector<HTMLElement>(`[data-testid="lc-node-${back}"]`)?.focus();
  }, [open]);

  return (
    <KitHost testId="lc-journey">
      <div ref={hostRef} className="space-y-5 pb-6">
        <LifecycleActions />
        {open ? <StepScreen node={open} /> : order.length > 0 ? <Layer1 /> : loading ? <JourneyGhost /> : null}
      </div>
    </KitHost>
  );
}
