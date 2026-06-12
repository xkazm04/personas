import { useState } from 'react';
import { AlertTriangle, Check, Globe, ShieldAlert, X } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { companionFileBrowserDefects } from '@/api/companion';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface ReportStep {
  label?: string;
  result?: string;
  evidence?: string;
}
interface ReportDefect {
  title?: string;
  severity?: string;
  detail?: string;
  fix?: string;
}

const RESULT_ICON: Record<string, typeof Check> = {
  pass: Check,
  fail: X,
  warn: AlertTriangle,
};
const RESULT_TONE: Record<string, string> = {
  pass: 'text-status-success',
  fail: 'text-status-error',
  warn: 'text-status-warning',
};
const SEVERITY_TONE: Record<string, string> = {
  high: 'border-status-error/40 bg-status-error/[0.05]',
  medium: 'border-status-warning/40 bg-status-warning/[0.05]',
  low: 'border-foreground/10 bg-secondary/40',
};

/**
 * Structured verdict card a browser-test turn ends with
 * (`show_browser_test_report`): steps with observed evidence, defects with
 * severity + suggested fix, verbatim console errors, and security notes.
 * Unclamped in InlineChatCard — a report is meant to be read.
 */
export function BrowserTestReportWidget({ config, title }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const [filed, setFiled] = useState<number | null>(null);
  const [filing, setFiling] = useState(false);

  const url = typeof config?.url === 'string' ? config.url : '';
  const projectName =
    typeof config?.project_name === 'string' ? config.project_name : '';
  const steps = (Array.isArray(config?.steps) ? config.steps : []) as ReportStep[];
  const defects = (Array.isArray(config?.defects) ? config.defects : []) as ReportDefect[];
  const consoleErrors = (
    Array.isArray(config?.console_errors) ? config.console_errors : []
  ).map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
  const securityNotes = (
    Array.isArray(config?.security_notes) ? config.security_notes : []
  ).map((n) => (typeof n === 'string' ? n : JSON.stringify(n)));

  if (steps.length === 0) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-4 typo-caption text-foreground">
        {c.browser_report_empty}
      </div>
    );
  }

  const fileDefects = async () => {
    setFiling(true);
    try {
      const n = await companionFileBrowserDefects(url, projectName || undefined, defects);
      setFiled(n);
    } catch (e) {
      toastCatch('BrowserTestReportWidget:fileDefects')(e);
    } finally {
      setFiling(false);
    }
  };

  return (
    <div
      className="rounded-card border border-sky-500/30 bg-sky-500/[0.04] p-4 space-y-3"
      data-testid="companion-browser-test-report"
    >
      <header className="flex items-center gap-2 typo-caption text-sky-300/85">
        <Globe className="w-3.5 h-3.5" />
        <span className="font-medium">{title || c.browser_report_title}</span>
        {url && <span className="truncate text-foreground/60">{url}</span>}
      </header>

      <ul className="space-y-1.5">
        {steps.map((s, i) => {
          const Icon = RESULT_ICON[s.result ?? ''] ?? AlertTriangle;
          return (
            <li key={i} className="flex items-start gap-2">
              <Icon
                className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${RESULT_TONE[s.result ?? ''] ?? 'text-foreground'}`}
              />
              <div className="min-w-0">
                <span className="typo-body">{s.label}</span>
                {s.evidence && (
                  <p className="typo-caption text-foreground/70">{s.evidence}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {defects.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="typo-caption font-medium">{c.browser_report_defects}</h4>
          {defects.map((d, i) => (
            <div
              key={i}
              className={`rounded-interactive border p-2 ${SEVERITY_TONE[d.severity ?? 'low'] ?? SEVERITY_TONE.low}`}
            >
              <p className="typo-body font-medium">{d.title}</p>
              {d.detail && <p className="typo-caption">{d.detail}</p>}
              {d.fix && <p className="typo-caption text-foreground/70">{d.fix}</p>}
            </div>
          ))}
          {filed === null ? (
            <AsyncButton
              size="sm"
              variant="secondary"
              isLoading={filing}
              onClick={fileDefects}
              data-testid="browser-report-file-ideas"
            >
              {c.browser_report_file_ideas}
            </AsyncButton>
          ) : (
            <p className="typo-caption text-status-success">
              {tx(c.browser_report_filed, { count: filed })}
            </p>
          )}
        </section>
      )}

      {consoleErrors.length > 0 && (
        <section>
          <h4 className="typo-caption font-medium">{c.browser_report_console}</h4>
          <pre className="mt-1 rounded-interactive bg-secondary/60 p-2 typo-caption whitespace-pre-wrap break-all">
            {consoleErrors.join('\n')}
          </pre>
        </section>
      )}

      {securityNotes.length > 0 && (
        <section className="flex items-start gap-2 rounded-interactive border border-status-warning/40 bg-status-warning/[0.05] p-2">
          <ShieldAlert className="mt-0.5 w-3.5 h-3.5 shrink-0 text-status-warning" />
          <div className="typo-caption">
            <span className="font-medium">{c.browser_report_security}: </span>
            {securityNotes.join(' · ')}
          </div>
        </section>
      )}
    </div>
  );
}
