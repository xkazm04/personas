import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Bell, ShieldAlert, Activity, PlayCircle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { WebhookSubscriptionsPanel } from './WebhookSubscriptionsPanel';
import { RecentChangeChip } from '@/features/settings/shared/RecentChangeChip';

type HealingSeverity = 'critical' | 'high' | 'medium' | 'low';

const SETTINGS_KEY = 'notification_prefs';

interface NotificationPrefs {
  healing_critical: boolean;
  healing_high: boolean;
  healing_medium: boolean;
  healing_low: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  healing_critical: true,
  healing_high: true,
  healing_medium: false,
  healing_low: false,
};

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

  const handleToggle = useCallback(() => {
    digestSetting.setValue(enabled ? 'false' : 'true');
  }, [enabled, digestSetting]);

  // Auto-save (debounced to prevent race conditions from rapid toggles)
  const digestLoadedOnce = useRef(false);
  useEffect(() => {
    if (!digestSetting.loaded) return;
    if (!digestLoadedOnce.current) {
      digestLoadedOnce.current = true;
      return;
    }
    const timer = setTimeout(() => digestSetting.save(), 300);
    return () => clearTimeout(timer);
  }, [digestSetting, digestSetting.value]);

  if (!digestSetting.loaded) return null;

  return (
    <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary/60" />
        <span className="typo-body font-medium text-foreground">{s.weekly_digest}</span>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="typo-body font-medium text-foreground">{s.digest_title}</span>
          <p className="typo-body text-foreground">
            {s.digest_description}
          </p>
        </div>
        <AccessibleToggle
          checked={enabled}
          onChange={handleToggle}
          label={s.weekly_digest_aria}
        />
      </div>
    </div>
  );
}

export default function NotificationSettings() {
  const setting = useAppSetting(SETTINGS_KEY, JSON.stringify(DEFAULT_PREFS), (v) => {
    try { const p = JSON.parse(v); return typeof p === 'object' && p !== null; } catch { /* intentional: non-critical -- JSON parse fallback */ return false; }
  });
  const hasLoadedOnce = useRef(false);
  const { t, tx } = useTranslation();
  const s = t.settings.notifications;

  // Auto-save whenever value changes (debounced to prevent race conditions from rapid toggles)
  useEffect(() => {
    if (!setting.loaded) return;
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      return;
    }
    const timer = setTimeout(() => setting.save(), 300);
    return () => clearTimeout(timer);
  }, [setting, setting.value]); // intentionally not including setting.save

  const prefs = useMemo<NotificationPrefs>(() => {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(setting.value) };
    } catch {
      // intentional: non-critical -- JSON parse fallback
      return DEFAULT_PREFS;
    }
  }, [setting.value]);

  // Ref tracks latest prefs synchronously so rapid toggles before re-render
  // don't lose intermediate changes (stale-closure + batched-setState race).
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const toggle = useCallback(
    (key: keyof NotificationPrefs) => {
      const current = prefsRef.current;
      const next = { ...current, [key]: !current[key] };
      prefsRef.current = next;
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
          <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary/60" />
              <span className="typo-body font-medium text-foreground">{s.healing_severity}</span>
            </div>

            <div className="divide-y divide-primary/10">
              {SEVERITY_ROWS.map(({ key, severity, labelKey, descKey, color }) => (
                <div key={key} className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <span className={`typo-body font-medium ${color}`}>{s[labelKey]}</span>
                    <p className="typo-body text-foreground">{s[descKey]}</p>
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
          </div>

          {/* Weekly Health Digest */}
          <WeeklyDigestToggle />

          {/* Outbound webhook subscriptions (Slack/Discord/Teams/generic JSON) */}
          <WebhookSubscriptionsPanel />

          <p className="typo-body text-foreground">
            {s.notification_hint}
          </p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
