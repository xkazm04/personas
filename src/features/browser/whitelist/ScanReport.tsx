/**
 * What the controllability scan found, rendered the same way wherever a
 * variant chooses to show it (inline in a card, in the detail pane, under a
 * ledger row). Pure presentation: it never scans, confirms or writes.
 *
 * The report is the page's OWN description of itself — untrusted input that
 * Rust has already classified. Nothing here re-derives a tool class from
 * `side_effects`; it renders the `class` the policy decided.
 */
import { AlertTriangle, FileText, MousePointerClick, Wrench } from 'lucide-react';

import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { BrowserSiteScan, BrowserToolClass } from '../types';

const CLASS_ACCENT: Record<BrowserToolClass, 'slate' | 'emerald' | 'amber'> = {
  read: 'slate',
  auto: 'emerald',
  gated: 'amber',
};

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="mt-0.5 text-foreground shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="typo-caption uppercase tracking-wider text-foreground">{label}</div>
        <div className="typo-body text-foreground flex flex-wrap items-center gap-1.5">{children}</div>
      </div>
    </div>
  );
}

export function ScanReport({ report, compact = false }: { report: BrowserSiteScan | null; compact?: boolean }) {
  const { t, tx } = useTranslation();
  const s = t.browser.scan_report;

  if (!report) {
    return <p className="typo-body text-foreground">{s.never_scanned}</p>;
  }

  const transportLabel = {
    'webmcp-native': s.transport_webmcp_native,
    'webmcp-polyfill': s.transport_webmcp_polyfill,
    none: s.transport_none,
  }[report.transport];

  const blockerLabel: Record<string, string> = {
    captcha: s.blocker_captcha,
    login_wall: s.blocker_login_wall,
    csp_frozen_globals: s.blocker_csp_frozen_globals,
  };

  const formKindLabel: Record<string, string> = {
    login: s.form_kind_login,
    search: s.form_kind_search,
    payment: s.form_kind_payment,
    other: s.form_kind_other,
  };

  return (
    <div className="space-y-3 min-w-0">
      <Row icon={<Wrench className="w-3.5 h-3.5" />} label={s.transport_label}>
        {transportLabel}
      </Row>

      <Row icon={<MousePointerClick className="w-3.5 h-3.5" />} label={s.operable}>
        {tx(s.operable_count, { count: report.operable_count })}
        {report.landmarks.length > 0 && (
          <span className="text-foreground">
            {' · '}
            {tx(s.landmarks_count, { count: report.landmarks.length })}
          </span>
        )}
      </Row>

      <Row icon={<FileText className="w-3.5 h-3.5" />} label={s.forms}>
        {report.forms.length === 0
          ? s.forms_none
          : report.forms.map((form) => (
              <StatusBadge key={`${form.name}:${form.kind}`} accent="slate" size="sm">
                {`${formKindLabel[form.kind] ?? form.kind} · ${tx(s.fields_count, { count: form.fields })}`}
              </StatusBadge>
            ))}
        <span className="text-foreground">
          {' · '}
          {report.login_form ? s.login_form_found : s.login_form_none}
        </span>
      </Row>

      {report.blockers.length > 0 && (
        <Row icon={<AlertTriangle className="w-3.5 h-3.5" />} label={s.blockers}>
          {report.blockers.map((blocker) => (
            <StatusBadge key={blocker} variant="warning" size="sm">
              {blockerLabel[blocker] ?? blocker}
            </StatusBadge>
          ))}
        </Row>
      )}

      {!compact && report.page_tools.length > 0 && (
        <Row icon={<Wrench className="w-3.5 h-3.5" />} label={s.page_tools}>
          {report.page_tools.map((tool) => (
            <Tooltip key={tool.name} content={tool.description}>
              <StatusBadge accent={CLASS_ACCENT[tool.class]} size="sm">
                {tool.name}
              </StatusBadge>
            </Tooltip>
          ))}
        </Row>
      )}

      {!compact && report.notes && (
        <p className="typo-caption text-foreground whitespace-pre-wrap">{report.notes}</p>
      )}
    </div>
  );
}

export default ScanReport;
