import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Bell, ShieldAlert, Activity } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { useTranslation } from '@/i18n/useTranslation';

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
  labelKey: 'severity_critical_label' | 'severity_high_label' | 'severity_medium_label' | 'severity_low_label';
  descKey: 'severity_critical' | 'severity_high' | 'severity_medium' | 'severity_low';
  color: string;
}> = [
  { key: 'healing_critical', labelKey: 'severity_critical_label', descKey: 'severity_critical', color: 'text-red-400' },
  { key: 'healing_high', labelKey: 'severity_high_label', descKey: 'severity_high', color: 'text-orange-400' },
  { key: 'healing_medium', labelKey: 'severity_medium_label', descKey: 'severity_medium', color: 'text-amber-400' },
  { key: 'healing_low', labelKey: 'severity_low_label', descKey: 'severity_low', color: 'text-blue-400' },
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
  }, [digestSetting.value]);

  if (!digestSetting.loaded) return null;

  return (
    <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary/60" />
        <span className="text-sm font-medium text-foreground/80">{s.weekly_digest}</span>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-sm font-medium text-foreground/80">{s.digest_title}</span>
          <p className="text-sm text-muted-foreground/80">
            {s.digest_description}
          </p>
        </div>
        <AccessibleToggle
          checked={enabled}
          onChange={handleToggle}
          label="Weekly health digest"
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
  const { t } = useTranslation();
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
  }, [setting.value]); // intentionally not including setting.save

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

  if (!setting.loaded) return null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bell className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="space-y-6">
          <div className="rounded-modal border border-primary/15 bg-secondary/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary/60" />
              <span className="text-sm font-medium text-foreground/80">{s.healing_severity}</span>
            </div>

            <div className="divide-y divide-primary/10">
              {SEVERITY_ROWS.map(({ key, labelKey, descKey, color }) => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <div className="space-y-0.5">
                    <span className={`text-sm font-medium ${color}`}>{s[labelKey]}</span>
                    <p className="text-sm text-muted-foreground/80">{s[descKey]}</p>
                  </div>
                  <AccessibleToggle
                    checked={prefs[key]}
                    onChange={() => toggle(key)}
                    label={`${s[labelKey]} notifications`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Health Digest */}
          <WeeklyDigestToggle />

          <p className="text-sm text-muted-foreground/80">
            {s.notification_hint}
          </p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
