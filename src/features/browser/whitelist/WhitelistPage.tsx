import { ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';

/**
 * Browser > Whitelist — the origin gate every browser backend consults.
 *
 * WP0 stub (spark browser-control): permanent chrome + the settled empty
 * state, so the route renders while the site table, scan report and the
 * three design variants land in WP4. See docs/features/browser.md.
 */
export default function WhitelistPage() {
  const { t } = useTranslation();
  return (
    <ContentBox data-testid="whitelist-page">
      <ContentHeader title={t.browser.whitelist.title} subtitle={t.browser.whitelist.subtitle} />
      <EmptyState
        icon={ShieldCheck}
        title={t.browser.whitelist.empty_title}
        description={t.browser.whitelist.empty_description}
      />
    </ContentBox>
  );
}
