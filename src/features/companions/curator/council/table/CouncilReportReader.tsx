// The council's FULL report, one click from its one-sentence summary.
//
// The ingest door keeps only `report.md`'s first paragraph (as the run's
// summary); the document itself stays in the run directory. This reads it
// on demand through `dev_tools_council_read_report` (report.html preferred,
// confined to the run dir) and renders it with the shared `ReportBody`, so a
// council report and a persona report are read on the same surface. Relative
// media in an HTML report resolve through the confined `read_media` door.
import { useEffect, useId, useMemo, useState } from 'react';
import { BookOpen, FileX, AlertCircle } from 'lucide-react';

import { createCouncilMediaResolver, readCouncilReport } from '@/api/devTools/council';
import type { CouncilReport } from '@/lib/bindings/CouncilReport';
import { Button } from '@/features/shared/components/buttons';
import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { ReportBody } from '@/features/shared/components/document/ReportBody';
import { DocumentGhost } from '@/features/shared/components/document/DocumentGhost';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { isTauriError } from '@/lib/types/tauriError';
import { silentCatch } from '@/lib/silentCatch';

type ReportState =
  | { status: 'loading' }
  | { status: 'ready'; report: CouncilReport }
  | { status: 'missing' }
  | { status: 'failed'; detail: string };

function useCouncilReport(runId: string): ReportState {
  const [state, setState] = useState<ReportState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    readCouncilReport(runId).then(
      (report) => {
        if (!cancelled) setState({ status: 'ready', report });
      },
      (err: unknown) => {
        if (cancelled) return;
        // `not_found` is the door's typed "this run wrote no report" (or the
        // run / its directory is gone) - a quiet state, not an error.
        if (isTauriError(err) && err.kind === 'not_found') {
          setState({ status: 'missing' });
          return;
        }
        silentCatch('features/companions/curator/council/table/CouncilReportReader:read')(err);
        setState({ status: 'failed', detail: isTauriError(err) ? err.error : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runId]);
  return state;
}

function CouncilReportModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const state = useCouncilReport(runId);
  // One resolver per open reader; every blob URL it minted is revoked on close.
  const media = useMemo(() => createCouncilMediaResolver(runId), [runId]);
  useEffect(() => () => media.dispose(), [media]);

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      titleId={titleId}
      width="lg"
      icon={<BookOpen className="w-5 h-5" />}
      title={t.overview.reader_full_report_title}
    >
      {state.status === 'loading' && <DocumentGhost testId="council-report-ghost" />}
      {state.status === 'ready' && (
        <article data-testid="council-report-body">
          <ReportBody
            document={{
              format: state.report.format === 'html' ? 'html' : 'markdown',
              content: state.report.content,
            }}
            title={t.overview.reader_full_report_title}
            resolveMedia={media.resolve}
          />
        </article>
      )}
      {state.status === 'missing' && (
        <ScenarioEmptyState
          icon={FileX}
          title={t.overview.reader_no_full_report}
          subtitle={t.overview.reader_no_full_report_hint}
        />
      )}
      {state.status === 'failed' && (
        <ScenarioEmptyState
          icon={AlertCircle}
          title={t.overview.reader_report_unreadable}
          subtitle={state.detail}
        />
      )}
    </ModalShell>
  );
}

/** The "Read full report" control and the reader it opens. */
export function CouncilFullReport({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<BookOpen className="w-3.5 h-3.5" />}
        onClick={() => setOpen(true)}
        data-testid="council-read-full-report"
      >
        {t.overview.reader_read_full_report}
      </Button>
      {open && <CouncilReportModal runId={runId} onClose={() => setOpen(false)} />}
    </>
  );
}
