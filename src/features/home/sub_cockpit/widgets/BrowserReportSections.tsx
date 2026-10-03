import { useMemo } from 'react';

import { Hint, ListRow, Rows, Section, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

export interface ReportStep {
  label?: string;
  result?: string;
  evidence?: string;
}
export interface ReportDefect {
  title?: string;
  severity?: string;
  detail?: string;
  fix?: string;
}

interface StepRow extends ReportStep {
  key: string;
}
interface DefectRow extends ReportDefect {
  key: string;
  /** The cause and the suggested fix, as the row shows them. */
  why: string;
}

const RESULT_TONE: Record<string, Tone> = { pass: 'success', fail: 'error', warn: 'warning' };
const SEVERITY_TONE: Record<string, Tone> = { critical: 'error', high: 'error', medium: 'warning', low: 'neutral' };

/** A meta line that may truncate: its full text in the kit Hint, never cut silently. */
function Clipped({ text }: { text: string }) {
  return <Hint content={text}><span className="k-ellipsis">{text}</span></Hint>;
}

/**
 * The body of the browser-test report tile: the steps (result on each row's accent), then the
 * defects (severity on the accent, the cause and the suggested fix beside the title) as two
 * `UnifiedTable`s - the app's shared table (see `widgetTable.tsx`) - and the verbatim console
 * errors and security notes as kit `Rows`, each a level-2 kit Section inside the one Tile.
 *
 * Steps and defects name their second column ("Description") instead of the generic "Detail" head
 * the owner removed by name on 2026-10-03. The console and security lists are NOT tables: they
 * are one verbatim line each with nothing to put in a second column, which is exactly the case
 * `ListRow` still serves (only the kit's COLUMN mode retires, not the row).
 */
export function BrowserReportSections({ steps, defects, consoleErrors, securityNotes }: {
  steps: ReportStep[];
  defects: ReportDefect[];
  consoleErrors: string[];
  securityNotes: string[];
}) {
  const { t } = useTranslation();
  const c = t.athena;
  const stepRows: StepRow[] = steps.map((s, i) => ({ ...s, key: `${i}-${s.label ?? ''}` }));
  const defectRows: DefectRow[] = defects.map((d, i) => ({
    ...d,
    key: `${i}-${d.title ?? ''}`,
    why: [d.detail, d.fix].filter(Boolean).join(' · '),
  }));

  const stepColumns = useMemo<TableColumn<StepRow>[]>(() => {
    const resultLabel: Record<string, string> = {
      pass: t.templates.test_report.status_passed,
      fail: t.templates.test_report.status_failed,
      warn: t.overview.health.warning,
    };
    return [
      {
        key: 'label',
        label: t.overview.cockpit.col_step,
        width: 'minmax(0, 1fr)',
        render: (s) => nameCell(s.label, resultLabel[s.result ?? ''] ?? (s.result || c.browser_report_steps), s.label),
      },
      {
        key: 'evidence',
        label: t.common.description,
        width: 'minmax(0, 1.6fr)',
        render: (s) => <Cell value={s.evidence} hint={s.evidence} />,
      },
    ];
  }, [c.browser_report_steps, t]);

  const defectColumns = useMemo<TableColumn<DefectRow>[]>(() => [
    {
      key: 'title',
      label: c.browser_report_defects,
      width: 'minmax(0, 1fr)',
      render: (d) => nameCell(d.title, tokenLabel(t, 'severity', d.severity ?? 'low'), d.title),
    },
    {
      key: 'why',
      label: t.common.description,
      width: 'minmax(0, 1.6fr)',
      render: (d) => <Cell value={d.why} hint={d.why} />,
    },
  ], [c.browser_report_defects, t]);

  return (
    <>
      <WidgetTable<StepRow>
        columns={stepColumns}
        rows={stepRows}
        getRowKey={(s) => s.key}
        rowTone={(s) => RESULT_TONE[s.result ?? ''] ?? 'neutral'}
        emptyTitle={c.browser_report_empty}
        label={c.browser_report_steps}
        testId="companion-browser-report-steps"
      />
      {defects.length > 0 && (
        <Section level={2} title={c.browser_report_defects} count={defects.length}>
          <WidgetTable<DefectRow>
            columns={defectColumns}
            rows={defectRows}
            getRowKey={(d) => d.key}
            rowTone={(d) => SEVERITY_TONE[d.severity ?? 'low'] ?? 'neutral'}
            emptyTitle={c.browser_report_empty}
            label={c.browser_report_defects}
            testId="companion-browser-report-defects"
          />
        </Section>
      )}
      {consoleErrors.length > 0 && (
        <Section level={2} title={c.browser_report_console} count={consoleErrors.length}>
          <Rows count={consoleErrors.length} empty={{ title: '' }}>
            {consoleErrors.map((line, i) => (
              <ListRow key={i} size="line" nameClass="typo-code k-regular" name={<Clipped text={line} />} mark={{ tone: 'error', glyph: 'hollow', label: c.browser_report_console }} />
            ))}
          </Rows>
        </Section>
      )}
      {securityNotes.length > 0 && (
        <Section level={2} title={c.browser_report_security} count={securityNotes.length}>
          <Rows count={securityNotes.length} empty={{ title: '' }}>
            {securityNotes.map((note, i) => (
              <ListRow key={i} size="line" nameClass="typo-body" name={<Clipped text={note} />} />
            ))}
          </Rows>
        </Section>
      )}
    </>
  );
}
