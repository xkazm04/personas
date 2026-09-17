/**
 * The tab strip, rendered straight from the `browser-tabs` event.
 *
 * Rust is authoritative: the event carries the WHOLE list every time any of it
 * moves, so there is no local tab model to drift. Clicking a tab asks Rust to
 * focus it; the strip repaints when Rust says it did, not when we clicked.
 *
 * NOT AN ARIA TABLIST, DELIBERATELY. `role="tablist"` promises that the control
 * selects among mutually exclusive regions IN THIS DOCUMENT, and the region
 * these tabs select is a separate OS window that is not in the accessibility
 * tree at all. There is no element that could honestly carry `role="tabpanel"`,
 * so the strip is a list and the current tab is marked with `aria-current`,
 * which is a claim that is true.
 */
import { X } from 'lucide-react';

import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserTab } from '../types';

interface TabStripProps {
  tabs: readonly BrowserTab[];
  activeTabId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
}

export default function TabStrip({ tabs, activeTabId, onSelect, onClose }: TabStripProps) {
  const { t } = useTranslation();
  const v = t.browser.webview;

  if (tabs.length === 0) return null;

  return (
    <div role="list" aria-label={v.tabs_aria} className="flex items-center gap-1 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="listitem"
            className={[
              'group flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-interactive border transition-colors max-w-56 min-w-0',
              active
                ? 'border-primary/30 bg-primary/10'
                : 'border-primary/10 bg-secondary/30 hover:border-primary/20',
            ].join(' ')}
          >
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(tab.id)}
              data-testid={`webview-tab-${tab.id}`}
              className="flex items-center gap-1.5 min-w-0 focus-ring rounded-interactive"
            >
              {tab.lease && <LiveStatusDot tone="syncing" />}
              <span className="typo-caption text-foreground truncate">{tab.title || v.untitled}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              aria-label={v.close_tab}
              data-testid={`webview-tab-close-${tab.id}`}
              className="p-0.5 rounded-interactive text-foreground hover:text-foreground focus-ring"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
