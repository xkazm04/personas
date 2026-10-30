import { useCallback, useMemo, useRef, useState } from 'react';
import { Bell, ShieldAlert, Activity, PlayCircle, DollarSign } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { useDebouncedSave } from '@/hooks/utility/timing/useDebouncedSave';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { WebhookSubscriptionsPanel } from './WebhookSubscriptionsPanel';
import { RecentChangeChip } from '@/features/settings/shared/RecentChangeChip';
import { HealthDigestPanel } from '@/features/agents/sub_health/HealthDigestPanel';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_PREFS_KEY,
  parseNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/notifications/notificationPrefs';

type HealingSeverity = 'critical' | 'high' | 'medium' | 'low';

// The blob's shape, defaults and parser live in one accessor. This tab writes
// it; the doors read it where their events arrive (HealingToast for the four
// severities, SpendAlertWatcher for spend_alerts), whether or not this tab is
// mounted.

const SEVERITY_ROWS: Array<{
  key: keyof NotificationPrefs;
  severity: HealingSeverity;
  labelKey: 'severity_critical_label' | 'severity_high_label' | 'severity_medium_label' | 'severity_low_label';
  descKey: 'severity_critical' | 'severity_high' | 'severity_medium' | 'severity_low';
  color: string;
}> = [
  { key: 'healing_critical', severity: 'critical', labelKey: 'severity_critical_label', descKey: 'severity_critical', color: 'text-red-400' },
  { key: 'healing_high', severity: 'high', labelKey: 'severity_high_label', descKey: 'severity_high', color: 'text-orange-400' },
  { key: 'healing_medium', severity: 'medium', labelKey: 'severity_medium_label', descKey: 'severity_medium', color: 'text-amber-400' },
  { key: 'healing_low', severity: 'low', labelKey: 'severity_low_label', descKey: 'severity_low', color: 'text-blue-400' },
];

function WeeklyDigestToggle() {
  const digestSetting = useAppSetting('health_digest_enabled', 'true', (v) => v === 'true' || v === 'false');
  const { t } = useTranslation();
  const s = t.settings.notifications;

  const enabled = digestSetting.value === 'true';

  const [edited, setEdited] = useState(false);
  const handleToggle = useCallback(() => {
    setEdited(true);
    digestSetting.setValue(enabled ? 'false' : 'true');
  }, [enabled, digestSetting]);

  // Auto-save, debounced so rapid toggles coalesce into one write, and FLUSHED
  // on unmount: a toggle made in the last 300ms before leaving the tab used to
  // be dropped by the timer cleanup. Keyed on the scalar value, never the
  // per-render setting object (that caused a write loop).
  useDebouncedSave(() => digestSetting.save(), digestSetting.loaded && edited, [digestSetting.value], 300);

  if (!digestSetting.loaded) return null;

  return (
    <SectionCard
      title={s.weekly_digest}
      icon={<Activity className="w-4 h-4 text-primary/60" />}
      titleClassName="text-primary"
    >
      <SettingRow
        label={s.digest_title}
        description={s.digest_description}
        checked={enabled}
        onChange={handleToggle}
      />
      {digestSetting.error && (
        <p role="alert" className="typo-caption text-status-error mt-2">{digestSetting.error}</p>
      )}
      {/* The digest's drill-down: which agents need attention, and why. */}
      <HealthDigestPanel />
    </SectionCard>
  );
}

export default function NotificationSettings() {
  const setting = useAppSetting(NOTIFICATION_PREFS_KEY, JSON.stringify(DEFAULT_NOTIFICATION_PREFS), (v) => {
    try { const p = JSON.parse(v); return typeof p === 'object' && p !== null; } catch { /* intentional: non-critical -- JSON parse fallback */ return false; }
  });
  const [edited, setEdited] = useState(false);
  const { t, tx } = useTranslation();
  const s = t.settings.notifications;

  // Auto-save after an operator edit, debounced so rapid toggles coalesce, and
  // flushed on unmount so a toggle made just before leaving the tab still
  // lands. Deps are the scalar value, NOT the `setting` object: useAppSetting
  // returns a fresh object every render, and depending on it once produced an
  // endless set_app_setting write loop while the tab was mounted.
  useDebouncedSave(() => setting.save(), setting.loaded && edited, [setting.value], 300);

  const prefs = useMemo<NotificationPrefs>(() => parseNotificationPrefs(setting.value), [setting.value]);

  // Ref tracks latest prefs synchronously so rapid toggles before re-render
  // don't lose intermediate changes (stale-closure + batched-setState race).
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const toggle = useCallback(
    (key: keyof NotificationPrefs) => {
      const current = prefsRef.current;
      const next = { ...current, [key]: !current[key] };
      prefsRef.current = next;
      setEdited(true);
      setting.setValue(JSON.stringify(next));
    },
    [setting],
  );

  const fireTestToast = useCallback(
    (severity: HealingSeverity, levelLabel: string) => {
      useToastStore.getState().addHealingToast({
        // Suffix with Date.now() so repeat clicks produce repeat toasts rather
        // than being deduped by the issueId-based key in addHealingToast.
        issueId: `test-${severity}-${Date.now()}`,
        personaId: 'test',
        title: tx(s.test_issue_title, { level: levelLabel }),
        severity,
        personaName: s.test_persona_name,
        suggestedFix: s.test_suggested_fix,
      });
    },
    [s, tx],
  );

  if (!setting.loaded) return null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bell className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={s.title}
        subtitle={s.subtitle}
        actions={<RecentChangeChip category="notifications" />}
      />

      <ContentBody centered>
        <div className="space-y-6">
          <SectionCard
            title={s.healing_severity}
            icon={<ShieldAlert className="w-4 h-4 text-primary/60" />}
            titleClassName="text-primary"
          >
            <div className="divide-y divide-foreground/5">
              {SEVERITY_ROWS.map(({ key, severity, labelKey, descKey, color }) => (
                <div key={key} className="flex items-center justify-between py-2.5 gap-3 first:pt-0 last:pb-0">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <span className={`typo-body ${color}`}>{s[labelKey]}</span>
                    <p className="typo-caption text-foreground">{s[descKey]}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => fireTestToast(severity, s[labelKey])}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption text-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title={tx(s.test_button_tooltip, { level: s[labelKey] })}
                    >
                      <PlayCircle size={12} />
                      {s.test_button}
                    </button>
                    <AccessibleToggle
                      checked={prefs[key]}
                      onChange={() => toggle(key)}
                      label={tx(s.severity_toggle_aria, { level: s[labelKey] })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title={s.spend_alerts_label}
            icon={<DollarSign className="w-4 h-4 text-primary/60" />}
            titleClassName="text-primary"
          >
            <SettingRow
              label={s.spend_alerts_label}
              description={s.spend_alerts_desc}
              checked={prefs.spend_alerts}
              onChange={() => toggle('spend_alerts')}
            />
          </SectionCard>

          {/* Weekly Health Digest */}
          <WeeklyDigestToggle />

          {/* Outbound webhook subscriptions (Slack/Discord/Teams/generic JSON) */}
          <WebhookSubscriptionsPanel />

          {setting.error && (
            <p role="alert" className="typo-caption text-status-error">{setting.error}</p>
          )}

          <p className="typo-body text-foreground">
            {s.notification_hint}
          </p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
