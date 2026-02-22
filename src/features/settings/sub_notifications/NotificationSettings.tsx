import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Bell, ShieldAlert } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useAppSetting } from '@/hooks/utility/useAppSetting';

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

export default function NotificationSettings() {
  const setting = useAppSetting(SETTINGS_KEY, JSON.stringify(DEFAULT_PREFS));
  const hasLoadedOnce = useRef(false);

  // Auto-save whenever value changes (skip the initial load)
  useEffect(() => {
    if (!setting.loaded) return;
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      return;
    }
    setting.save();
  }, [setting.value]); // intentionally not including setting.save

  const prefs = useMemo<NotificationPrefs>(() => {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(setting.value) };
    } catch {
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
                  <button
                    onClick={() => toggle(key)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      prefs[key] ? 'bg-primary/60' : 'bg-secondary/80 border border-border/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-foreground/90 transition-transform ${
                        prefs[key] ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-muted-foreground/80">
            Desktop notifications use the native OS notification system. In-app toasts appear for critical and high severity issues regardless of these settings.
          </p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
