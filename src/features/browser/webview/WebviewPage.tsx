import { Globe } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';

/**
 * Browser > Webview — the embedded page host the operator and agents share.
 *
 * WP0 stub (spark browser-control): permanent chrome + the settled empty
 * state. The tab strip, address bar, lease badge and the native page slot
 * (measured here, positioned by Rust) land in WP4 on top of the WP2 backend.
 * See docs/features/browser.md.
 */
export default function WebviewPage() {
  const { t } = useTranslation();
  return (
    <ContentBox data-testid="webview-page">
      <ContentHeader title={t.browser.webview.title} subtitle={t.browser.webview.subtitle} />
      <EmptyState
        icon={Globe}
        title={t.browser.webview.empty_title}
        description={t.browser.webview.empty_description}
      />
    </ContentBox>
  );
}
