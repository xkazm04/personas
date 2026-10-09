// PROTOTYPE ROUND (spark council-readout, direction H). The card's one
// prominent action: open the round's browser report (`report.html`, written
// beside `report.md` by `scripts/council/render-report.mjs`) in the default
// browser, with the run folder underneath as a copyable path. The report
// only ever reads; the decision stays on this card's gate.
import { ExternalLink } from 'lucide-react';

import { openLocalPath } from '@/api/system/system';
import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { toastCatch } from '@/lib/silentCatch';

import { reportHtmlPath } from '../../protoModel';

const S = {
  read: 'Read full report',
  copy: 'Copy the run folder',
};

export function ReportAction({ runDir }: { runDir: string }) {
  return (
    <div className="flex w-full max-w-[26rem] flex-col items-start gap-2.5 sm:w-auto">
      <Button
        variant="primary"
        size="lg"
        icon={<ExternalLink className="h-5 w-5" />}
        onClick={() => void openLocalPath(reportHtmlPath(runDir)).catch(toastCatch('council:open-report'))}
        className="typo-heading"
        data-testid="council-hybrid-report"
      >
        {S.read}
      </Button>
      <div className="flex max-w-full items-center gap-2">
        <span className="min-w-0 truncate typo-code text-muted" dir="rtl">
          {/* rtl keeps the run's own folder name visible when the path is cut */}
          <bdi>{runDir}</bdi>
        </span>
        <CopyButton text={runDir} tooltip={S.copy} />
      </div>
    </div>
  );
}
