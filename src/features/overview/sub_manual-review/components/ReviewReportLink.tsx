import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { openReportInReports } from '@/features/overview/sub_reports/libs/openReportInReports';
import { parseLinkedReportId } from '../libs/linkedReport';

/**
 * "View report" - shown on an approval whose `context_data.reportId` names a
 * report, and nowhere else. The report carries the evidence (screenshots) the
 * decision is about; the link opens it on Overview > Reports.
 */
export function ReviewReportLink({ contextData }: { contextData: string | null | undefined }) {
  const { t } = useTranslation();
  const reportId = useMemo(() => parseLinkedReportId(contextData), [contextData]);
  if (!reportId) return null;
  return (
    <div className="flex-shrink-0">
      <Button
        variant="ghost"
        size="sm"
        data-testid="review-view-report"
        icon={<FileText className="h-3.5 w-3.5" />}
        onClick={() => openReportInReports(reportId)}
      >
        {t.overview.review.view_report}
      </Button>
    </div>
  );
}
