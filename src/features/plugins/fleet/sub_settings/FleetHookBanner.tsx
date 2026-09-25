import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import { DebtText } from '@/i18n/DebtText';

/** The status band's frame: one recipe, the tone names the meaning. */
function Band({ tone, testId, head, children }: {
  tone: 'success' | 'warning' | 'neutral';
  testId: string;
  head: ReactNode;
  children?: ReactNode;
}) {
  const frame = {
    success: 'border-status-success/25 bg-status-success/5',
    warning: 'border-status-warning/25 bg-status-warning/5',
    neutral: 'border-primary/15 bg-primary/5',
  }[tone];
  return (
    <div className={`border rounded-modal px-4 py-3 ${frame}`} data-testid={testId}>
      {head}
      {children && <p className="typo-body text-foreground mt-1">{children}</p>}
    </div>
  );
}

// Inline in a sentence: the mono face at the sentence's own size (typo-code is a step smaller).
const code = 'font-mono';

/**
 * Hook installation status at the top of Fleet Settings: loading, installed,
 * installed against a stale port, or missing. Status colour marks the two
 * verdicts; the loading and missing bands stay on the theme's primary tint.
 */
export function FleetHookBanner({ status }: { status: FleetHookStatus | null }) {
  if (!status) {
    return (
      <Band tone="neutral" testId="fleet-hooks-banner-loading" head={
        <p className="typo-caption"><DebtText k="auto_loading_hook_status_23866317" /></p>
      } />
    );
  }
  if (status.installed && !status.portMatches) {
    return (
      <Band tone="warning" testId="fleet-hooks-banner-mismatch" head={
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-warning" aria-hidden="true" />
          <p className="typo-heading text-status-warning"><DebtText k="auto_port_mismatch_b07961a1" /></p>
        </div>
      }>
        <DebtText k="auto_hooks_point_to_port_36464ae7" />{' '}
        <code className={code}>{status.installedPort ?? '?'}</code> <DebtText k="auto_but_the_current_in_app_http_server_bound_t_ffe9bca1" />
      </Band>
    );
  }
  if (status.installed) {
    return (
      <Band tone="success" testId="fleet-hooks-banner-installed" head={
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-status-success" aria-hidden="true" />
          <p className="typo-heading text-status-success"><DebtText k="auto_hooks_installed_dfe5c9be" /></p>
        </div>
      }>
        <DebtText k="auto_claude_code_posts_lifecycle_events_to_f1cd7ead" />{' '}
        <code className={code}><DebtText k="auto_http_127_0_0_1_7c241e82" />{status.installedPort}<DebtText k="auto_fleet_hooks_40b93aeb" /></code><DebtText k="auto_sessions_you_spawn_from_fleet_and_any_exte_cbcbfcc7" />{' '}
        <code className={code}>claude</code> <DebtText k="auto_runs_with_the_same_cwd_report_state_in_rea_26cd9b3d" />
      </Band>
    );
  }
  return (
    <Band tone="neutral" testId="fleet-hooks-banner-missing" head={
      <p className="typo-heading text-foreground"><DebtText k="auto_hooks_not_installed_772fd030" /></p>
    }>
      <DebtText k="auto_fleet_needs_six_hook_entries_in_27ce6397" />{' '}
      <code className={code}><DebtText k="auto_claude_settings_json_3ce7a994" /></code> <DebtText k="auto_sessionstart_notification_stop_pretooluse__9837beb9" />{' '}
      <code className={code}><DebtText k="auto_fleet_true_cfae4a45" /></code> <DebtText k="auto_marker_so_uninstall_is_surgical_a97c8e30" />
    </Band>
  );
}
