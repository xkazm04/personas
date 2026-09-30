import { useEffect, useRef, useState } from 'react';
import { KitButton, Meta, Tile } from '@/features/shared/components/kit';
import { companionFileBrowserDefects } from '@/api/companion';
import { completeGoalUat } from '@/api/devTools/devTools';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { BrowserReportSections, type ReportDefect, type ReportStep } from './BrowserReportSections';

/**
 * Structured verdict card a browser-test turn ends with
 * (`show_browser_test_report`): steps with observed evidence, defects with
 * severity + suggested fix, verbatim console errors, and security notes.
 * One kit Tile, as tall as the report (a report is meant to be read): the
 * URL and the UAT outcome in the head's meta, the sections as rows, "File as
 * ideas" on the tile's foot.
 */
export function BrowserTestReportWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const c = t.athena;
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

  // Goal-UAT linkage: when this report is a goal's acceptance gate and EVERY
  // step passed, close the gate (tick the verify item → goal can reach done).
  // The "attempted" flag is persisted per goal so a remount (tab revisit,
  // spec recompose) can't re-fire the close call — a fresh ref would reset.
  const goalId = typeof config?.goal_id === 'string' ? config.goal_id : '';
  const allPass = steps.length > 0 && steps.every((s) => s.result === 'pass');
  const [uatClosed, setUatClosed] = useState(false);
  const closeAttemptedStorageKey = goalId ? `cockpit_uat_close_attempted:${goalId}` : '';
  const closeAttempted = useRef(
    closeAttemptedStorageKey ? window.localStorage.getItem(closeAttemptedStorageKey) === '1' : false,
  );
  useEffect(() => {
    if (goalId && allPass && !closeAttempted.current) {
      closeAttempted.current = true;
      try {
        window.localStorage.setItem(closeAttemptedStorageKey, '1');
      } catch (err) { silentCatch('BrowserTestReportWidget:persistAttempted')(err); }
      completeGoalUat(goalId)
        .then(() => setUatClosed(true))
        .catch(silentCatch('BrowserTestReportWidget:completeGoalUat'));
    }
  }, [goalId, allPass, closeAttemptedStorageKey]);

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

  const empty = steps.length === 0;
  const uatDone = !!goalId && uatClosed;
  const fileAction = defects.length > 0 && !empty
    ? filed === null
      ? <KitButton loading={filing} onClick={fileDefects} testId="browser-report-file-ideas">{c.browser_report_file_ideas}</KitButton>
      : <span className="typo-caption k-toned t-success">{tx(c.browser_report_filed, { count: filed })}</span>
    : null;

  return (
    <Tile
      span={span}
      title={title || c.browser_report_title}
      meta={empty || (!url && !uatDone) ? undefined : (
        <Meta parts={[
          url ? <span className="k-ellipsis">{url}</span> : null,
          uatDone ? <span className="k-toned t-success" data-testid="browser-report-uat-passed">{c.browser_report_uat_passed}</span> : null,
        ]} />
      )}
      actions={actions}
      footer={fileAction || footer ? <>{fileAction}{footer}</> : undefined}
      state={empty ? 'empty' : undefined}
      empty={{ title: c.browser_report_empty }}
      testId={empty ? 'companion-browser-test-report-empty' : 'companion-browser-test-report'}
    >
      <BrowserReportSections steps={steps} defects={defects} consoleErrors={consoleErrors} securityNotes={securityNotes} />
    </Tile>
  );
}
