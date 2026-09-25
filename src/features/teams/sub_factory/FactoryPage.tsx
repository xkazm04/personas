// Factory — next-generation KPI management surface.
//
// Baseline LOCKED to "Trend": the context × KPI matrix with micro-sparkline
// cells. Now wired to LIVE dev_tools data (factoryData) instead of mock, so we
// develop against real projects/KPIs. Architecture:
//   L1 Projects (score cards) → L2 context × KPI matrix (sparkline cells) →
//   L3 KPI table → L4 KpiConsole. Traffic-light colour; keyed transitions;
//   Back steps up one level.
import { FlaskConical } from 'lucide-react';

import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { FactoryDataProvider } from './factoryData';
import { TrendVariant } from './TrendVariant';

export default function FactoryPage() {
  const { t } = useTranslation();
  return (
    <ContentBox>
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-primary" />}
        title={t.sidebar.factory}
      />
      <ContentBody>
        <FactoryDataProvider>
          <TrendVariant />
        </FactoryDataProvider>
      </ContentBody>
    </ContentBox>
  );
}
