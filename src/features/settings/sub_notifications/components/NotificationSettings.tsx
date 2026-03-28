import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Bell, ShieldAlert, Activity } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';

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
  label: string;
  description: string;
  color: string;
}> = [
  {
    key: 'healing_critical',
    label: 'Critical',
    description: 'Circuit breaker tripped, CLI not found',
    color: 'text-red-400',
  },
  {
    key: 'healing_high',
    label: 'High',
    description: 'Credential errors, session limits, repeated timeouts',
    color: 'text-orange-400',
  },
  {
    key: 'healing_medium',
    label: 'Medium',
    description: 'Rate limits, first timeouts (auto-fixable)',
    color: 'text-amber-400',
  },
  {
    key: 'healing_low',
    label: 'Low',
    description: 'Informational issues',
    color: 'text-blue-400',
  },
];

function WeeklyDigestToggle() {
  const digestSetting = useAppSetting('health_digest_enabled', 'true', (v) => v === 'true' || v === 'false');

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
    <div className="rounded-xl border border-primary/15 bg-secondary/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary/60" />
        <span className="text-sm font-medium text-foreground/80">Weekly Health Digest</span>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-sm font-medium text-foreground/80">Agent Health Digest</span>
          <p className="text-sm text-muted-foreground/80">
            Weekly notification summarizing health issues across all agents with a total health score
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

  const toggle = useCallback(
    (key: keyof NotificationPrefs) => {
      const next = { ...prefs, [key]: !prefs[key] };
      setting.setValue(JSON.stringify(next));
    },
    [prefs, setting],
  );

  if (!setting.loaded) return null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bell className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Notifications"
        subtitle="Control which healing alerts trigger notifications"
      />

      <ContentBody centered>
        <div className="space-y-6">
          <div className="rounded-xl border border-primary/15 bg-secondary/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-primary/10 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary/60" />
              <span className="text-sm font-medium text-foreground/80">Healing Alert Severity</span>
            </div>

            <div className="divide-y divide-primary/10">
              {SEVERITY_ROWS.map(({ key, label, description, color }) => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <div className="space-y-0.5">
                    <span className={`text-sm font-medium ${color}`}>{label}</span>
                    <p className="text-sm text-muted-foreground/80">{description}</p>
                  </div>
                  <AccessibleToggle
                    checked={prefs[key]}
                    onChange={() => toggle(key)}
                    label={`${label} notifications`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Health Digest */}
          <WeeklyDigestToggle />

          <p className="text-sm text-muted-foreground/80">
            Desktop notifications use the native OS notification system. In-app toasts appear for critical and high severity issues regardless of these settings.
          </p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
