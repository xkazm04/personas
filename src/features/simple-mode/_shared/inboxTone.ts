/**
 * Shared accent-tone tokens for Simple-mode variant chrome.
 *
 * The five-tone palette (Phase 11) is closed by design — see
 * `styles/simple-mode.css` for the CSS utilities each tone exposes
 * (`simple-accent-{tone}-{text|soft|border|solid}`).
 *
 * Five files used to declare this same union locally; consolidating here
 * prevents drift if a sixth tone is ever added (one edit, not six).
 */
export type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';

import type { UnifiedInboxItem } from '../types';

/**
 * Map an inbox item to its Simple-mode accent tone.
 *
 * Mosaic, Console, and InboxList previously each carried their own
 * (`toneFor` / `toneForInbox` / `toneForKind`) implementation of this
 * mapping. Three sites of identical logic = drift hazard. The single
 * canonical mapping lives here.
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
