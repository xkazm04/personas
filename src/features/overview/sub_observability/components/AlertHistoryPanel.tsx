/**
 * Observability (composition kit): fired alerts as a Section of ListRows, newest first. A fired
 * alert's Mark is its rule's severity; a dismissed one recedes. Ten show, the rest behind Show all.
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KitButton, ListRow, Rows, Section } from '@/features/shared/components/kit';
import { SEVERITY_MARK } from './AlertRulesPanel';

const SHOWN = 10;

export function AlertHistoryPanel({ eyebrow }: { eyebrow?: string }) {
  const { t } = useTranslation();
  const { alertHistory, dismissAlert, clearAlertHistory } = useOverviewStore(useShallow((s) => ({
    alertHistory: s.alertHistory, dismissAlert: s.dismissAlert, clearAlertHistory: s.clearAlertHistory,
  })));
  const [all, setAll] = useState(false);
  const active = alertHistory.filter((a) => !a.dismissed).length;
  const shown = all ? alertHistory : alertHistory.slice(0, SHOWN);

  return (
    <Section
      id="s-obs-alert-history"
      eyebrow={eyebrow}
      title={t.overview.healing_issues_panel.alert_history_title}
      count={active}
      actions={alertHistory.length > 0 ? (
        <KitButton quiet onClick={() => { clearAlertHistory().catch(silentCatch('AlertHistoryPanel:clearAlertHistory')); }}>{t.common.clear}</KitButton>
      ) : undefined}
    >
      <Rows
        count={shown.length}
        empty={{ title: t.overview.emptyState.alerts_title, hint: t.overview.emptyState.alerts_subtitle, tone: 'success' }}
        label={t.overview.healing_issues_panel.alert_history_title}
        pager={alertHistory.length > SHOWN && !all ? (
          <>
            <span className="typo-data k-regular k-quiet">{shown.length} / {alertHistory.length}</span>
            <KitButton onClick={() => setAll(true)}>{t.overview.heartbeats.show_all}</KitButton>
          </>
        ) : undefined}
      >
        {shown.map((a) => (
          <ListRow
            key={a.id}
            size="m"
            name={a.rule_name}
            meta={a.message}
            mark={{ ...(SEVERITY_MARK[a.severity] ?? SEVERITY_MARK.info), glyph: a.dismissed ? 'hollow' : SEVERITY_MARK[a.severity]?.glyph ?? 'soft', label: a.severity }}
            state={a.dismissed ? 'muted' : undefined}
            time={<RelativeTime timestamp={a.fired_at} format="elapsed" showTooltip={false} />}
            figures={a.dismissed ? undefined : (
              <KitButton quiet onClick={() => { dismissAlert(a.id).catch(silentCatch('AlertHistoryPanel:dismissAlert')); }}>{t.common.dismiss}</KitButton>
            )}
          />
        ))}
      </Rows>
    </Section>
  );
}
