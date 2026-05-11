/**
 * Shared accent-tone tokens for inbox renderers.
 *
 * The five-tone palette is closed by design — see the cockpit styles for the
 * CSS utilities each tone exposes (`accent-{tone}-{text|soft|border|solid}`).
 */
export type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';

import type { UnifiedInboxItem } from '../types';

/**
 * Map an inbox item to its accent tone. Single canonical mapping; the cockpit
 * DecisionsPanel, the inline DecisionsCard, and overview/sub_inbox renderers
 * all read from here so a sixth tone or remapping happens in one place.
 */
export function toneForInboxItem(item: UnifiedInboxItem): Tone {
  switch (item.kind) {
    case 'approval':
      return 'amber';
    case 'message':
      return 'violet';
    case 'output':
      return 'emerald';
    case 'health':
      return item.severity === 'critical' ? 'rose' : 'gold';
  }
}
