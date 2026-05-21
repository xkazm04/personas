import { useMemo } from 'react';
import { DebtText } from '@/i18n/DebtText';


/**
 * IANA-zone picker for schedule triggers. Users can pick "system local"
 * (undefined value, backend falls back to the host's local time and emits
 * a debug log per fire — see scheduler.rs::compute_next_from_config) or
 * an explicit IANA zone. The list is curated; users with other zones can
 * still set them directly in the trigger config JSON.
 */
const COMMON_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Prague',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export interface TimezoneSelectProps {
  /** undefined = system-local fallback; string = IANA zone */
  value: string | undefined;
  onChange: (tz: string | undefined) => void;
  className?: string;
  id?: string;
}

export function getDetectedTimezone(): string | undefined {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return detected || undefined;
  } catch {
    return undefined;
  }
}

export function TimezoneSelect({ value, onChange, className, id }: TimezoneSelectProps) {
  const detected = useMemo(() => getDetectedTimezone(), []);

  const options = useMemo(() => {
    const set = new Set<string>(COMMON_ZONES);
    if (detected) set.add(detected);
    if (value) set.add(value);
    return Array.from(set).sort();
  }, [detected, value]);

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={className ??
        'px-3 py-2 bg-background/50 border border-primary/15 rounded-modal typo-body text-foreground focus-visible:border-primary/40 focus-ring transition-all'
      }
    >
      <option value=""><DebtText k="auto_system_local_fallback_03fd9916" /></option>
      {options.map((tz) => (
        <option key={tz} value={tz}>
          {tz}
          {tz === detected ? ' (detected)' : ''}
        </option>
      ))}
    </select>
  );
}
