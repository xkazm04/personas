// The drawer is opened ON a badge — `initialSection` is which badge was
// clicked. A tabbed drawer answered that by selecting a tab. Two of the three
// readings have no tabs, so they answer it by bringing the region into view
// instead; the id contract is `drawer-sec-<section>`.

import { useEffect } from 'react';
import type { DrawerSection } from '../monitorModel';

export const sectionAnchorId = (s: DrawerSection) => `drawer-sec-${s}`;

export function useSectionAnchor(section: DrawerSection, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const el = document.getElementById(sectionAnchorId(section));
    if (!el) return;
    // `instant` so the drawer does not animate twice: the sheet is already
    // springing down from the top edge as this runs.
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [section, ready]);
}
