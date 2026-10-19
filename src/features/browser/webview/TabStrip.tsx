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
import { AlertCircle, X } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserTab } from '../types';

interface TabStripProps {
  tabs: readonly BrowserTab[];
  activeTabId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  /**
   * The last tab-list read failed while tabs were already showing. The strip
   * keeps the old tabs (a failed read is not "no tabs") and says they may be
   * stale; the next successful read clears it (`adoptTabs`). With no tabs the
   * page's empty state carries the failure instead of this line.
   */
  error?: string | null;
  onRetry?: () => void;
}

export default function TabStrip({ tabs, activeTabId, onSelect, onClose, error = null, onRetry }: TabStripProps) {
  const { t } = useTranslation();
  const v = t.browser.webview;

  if (tabs.length === 0) return null;

  return (
    <>
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
      {error ? (
        <div role="alert" data-testid="webview-tabs-error" className="flex items-center gap-1.5 min-w-0">
          <AlertCircle className="w-3.5 h-3.5 text-status-error shrink-0" aria-hidden="true" />
          <span className="typo-caption text-status-error truncate">{error}</span>
          {onRetry ? (
            <Button size="xs" variant="ghost" onClick={onRetry} data-testid="webview-tabs-retry">
              {t.common.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
