// The card's one prominent action: open the latest round's browser report
// (`report.html`, rendered by the /council skill beside `report.md`) in the
// default browser, with the run folder underneath as a copyable path. The
// report only ever reads; the decision stays on this card's gate.
//
// The path is the projection's `reportPath`, which is set only when the file
// EXISTS. Without one - or while an older round is on screen, which that
// report does not describe - the action is disabled and its tooltip says why,
// so the reader is never handed a link that opens nothing.
import { ExternalLink } from 'lucide-react';

import { openLocalPath } from '@/api/system/system';
import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

export function ReportAction({
  reportPath,
  runDir,
  olderRound,
}: {
  reportPath: string | null;
  runDir: string | null;
  /** The round on screen is not the latest one the report describes. */
  olderRound: boolean;
}) {
  const { t } = useTranslation();
  const w = t.council.verdict;
  const why = olderRound ? w.older_round_report : reportPath ? null : w.no_report;
  const button = (
    <Button
      variant="primary"
      size="lg"
      icon={<ExternalLink className="h-5 w-5" />}
      disabled={why !== null}
      onClick={() => {
        if (reportPath) void openLocalPath(reportPath).catch(toastCatch('council:open-report'));
      }}
      className={`typo-heading${why ? ' pointer-events-none' : ''}`}
      data-testid="council-verdict-report"
    >
      {w.read_report}
    </Button>
  );
  return (
    <div className="flex w-full max-w-[26rem] flex-col items-start gap-2.5 sm:w-auto">
      {why ? (
        <Tooltip content={why} triggerFocusable placement="bottom">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {runDir ? (
        <div className="flex max-w-full items-center gap-2">
          <span className="min-w-0 truncate typo-code text-muted" dir="rtl">
            {/* rtl keeps the run's own folder name visible when the path is cut */}
            <bdi>{runDir}</bdi>
          </span>
          <CopyButton text={runDir} tooltip={w.copy_run} />
        </div>
      ) : null}
    </div>
  );
}
