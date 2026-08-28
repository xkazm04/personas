import type { Translations } from '@/i18n/en';

/** Translate common crontab patterns into short human-readable strings.
 *  Unknown patterns fall through to the raw cron so we never lie about intent.
 *
 *  Takes `t` because everything it returns is user-facing prose. It used to
 *  return hardcoded English — 'Every 5 min', 'Weekdays · 08:00', and a
 *  Sun/Mon/…/Sat day list — which then rendered untranslated in all 14
 *  locales. No gate saw it: `custom/no-hardcoded-jsx-text` inspects JSX text,
 *  and this is a returned string. Same `(t, …)` shape as `prettyTriggerType`.
 *
 *  The " · " separator and the "/" between day names deliberately stay in
 *  code: they are punctuation, not prose, and a key holding only placeholders
 *  and punctuation would be byte-identical in every locale — which is exactly
 *  what the untranslated-value gate is built to reject.
 */
export function humanizeCron(t: Translations, cron: string): string {
  const c = t.templates.chronology;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  // Multi-value minute OR hour fields (comma lists, ranges, steps) can't
  // collapse to a single "HH:MM" without losing runs — leave timeStr unset so
  // callers fall through to the raw cron instead of misrepresenting the
  // schedule. The guard has to cover BOTH fields: `parseInt("0,30")` is 0, so
  // guarding only the hour rendered `0,30 9 * * *` as "Daily · 09:00" and
  // silently dropped the 09:30 run.
  const multiValued = (f: string) => /[,/-]/.test(f);
  const timeMultiValued = multiValued(min) || multiValued(hour);

  const timeStr = (() => {
    if (timeMultiValued) return null;
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();

  const minEvery = /^\*\/(\d+)$/.exec(min);
  if (minEvery && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return c.cron_every_minutes.replace('{n}', minEvery[1]!);
  }

  const hourEvery = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && hourEvery && dom === '*' && mon === '*' && dow === '*') {
    return c.cron_every_hours.replace('{n}', hourEvery[1]!);
  }

  if (dom === '*' && mon === '*' && dow === '*' && timeStr) return `${c.cron_daily} · ${timeStr}`;
  if ((dow === '1-5' || dow === 'MON-FRI') && dom === '*' && mon === '*' && timeStr) {
    return `${c.cron_weekdays} · ${timeStr}`;
  }
  if ((dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN') && dom === '*' && mon === '*' && timeStr) {
    return `${c.cron_weekends} · ${timeStr}`;
  }

  if (dom === '*' && mon === '*' && timeStr) {
    // Localized short day names, Sunday-first to match cron's 0=Sunday. A
    // locale that supplies fewer than seven names simply drops the missing
    // ones (the `if (name)` guards below) rather than printing `undefined`.
    const dayNames = c.cron_day_names.split(',');
    const days: string[] = [];
    for (const part of dow.split(',')) {
      const range = /^(\d)-(\d)$/.exec(part);
      if (range) {
        const start = parseInt(range[1]!, 10);
        const end = parseInt(range[2]!, 10);
        for (let n = start; n <= end; n++) {
          const name = dayNames[n % 7];
          if (name) days.push(name);
        }
        continue;
      }
      const n = parseInt(part, 10);
      if (Number.isNaN(n) || n < 0 || n > 7) continue;
      const name = dayNames[n % 7];
      if (name) days.push(name);
    }
    if (days.length > 0) return `${days.join('/')} · ${timeStr}`;
  }
  return cron;
}
