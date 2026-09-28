import type { ReactNode } from 'react';
import { Hint, ListRow, Meta, Rows, Section, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

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

const RESULT_TONE: Record<string, Tone> = { pass: 'success', fail: 'error', warn: 'warning' };
const SEVERITY_TONE: Record<string, Tone> = { critical: 'error', high: 'error', medium: 'warning', low: 'neutral' };

/** A meta line that may truncate: its full text in the kit Hint, never cut silently. */
function Clipped({ text, children }: { text: string; children?: ReactNode }) {
  return <Hint content={text}><span className="k-ellipsis">{children ?? text}</span></Hint>;
}

/**
 * The body of the browser-test report tile: the steps (result on each mark), then the defects
 * (severity on the mark, the cause and the suggested fix as the meta), the verbatim console
 * errors and the security notes, each a level-2 kit Section of rows inside the one Tile.
 */
export function BrowserReportSections({ steps, defects, consoleErrors, securityNotes }: {
  steps: ReportStep[];
  defects: ReportDefect[];
  consoleErrors: string[];
  securityNotes: string[];
}) {
  const { t } = useTranslation();
  const c = t.athena;
  const resultLabel: Record<string, string> = {
    pass: t.templates.test_report.status_passed,
    fail: t.templates.test_report.status_failed,
    warn: t.overview.health.warning,
  };
  return (
    <>
      <Rows count={steps.length} empty={{ title: c.browser_report_empty }} label={c.browser_report_steps}>
        {steps.map((s, i) => (
          <ListRow
            key={i}
            size="s"
            name={s.label}
            mark={{ tone: RESULT_TONE[s.result ?? ''] ?? 'neutral', glyph: 'solid', label: resultLabel[s.result ?? ''] ?? (s.result || c.browser_report_steps) }}
            meta={s.evidence ? <Clipped text={s.evidence} /> : undefined}
          />
        ))}
      </Rows>
      {defects.length > 0 && (
        <Section level={2} title={c.browser_report_defects} count={defects.length}>
          <Rows count={defects.length} empty={{ title: '' }}>
            {defects.map((d, i) => {
              const sev = d.severity ?? 'low';
              const why = [d.detail, d.fix].filter(Boolean).join(' · ');
              return (
                <ListRow
                  key={i}
                  size="s"
                  name={d.title}
                  mark={{ tone: SEVERITY_TONE[sev] ?? 'neutral', glyph: sev === 'low' ? 'hollow' : 'solid', label: tokenLabel(t, 'severity', sev) }}
                  meta={why ? <Clipped text={why}><Meta parts={[d.detail, d.fix]} /></Clipped> : undefined}
                />
              );
            })}
          </Rows>
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
