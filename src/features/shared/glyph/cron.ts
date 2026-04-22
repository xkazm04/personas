const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Translate common crontab patterns into short human-readable strings.
 *  Unknown patterns fall through to the raw cron so we never lie about intent. */
export function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  const timeStr = (() => {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();

  const minEvery = /^\*\/(\d+)$/.exec(min);
  if (minEvery && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${minEvery[1]} min`;

  const hourEvery = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && hourEvery && dom === '*' && mon === '*' && dow === '*') return `Every ${hourEvery[1]}h`;

  if (dom === '*' && mon === '*' && dow === '*' && timeStr) return `Daily · ${timeStr}`;
  if ((dow === '1-5' || dow === 'MON-FRI') && dom === '*' && mon === '*' && timeStr) return `Weekdays · ${timeStr}`;
  if ((dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN') && dom === '*' && mon === '*' && timeStr) return `Weekends · ${timeStr}`;

  if (dom === '*' && mon === '*' && timeStr) {
    const days: string[] = [];
    for (const part of dow.split(',')) {
      const n = parseInt(part, 10);
      if (Number.isNaN(n) || n < 0 || n > 7) continue;
      const name = DAYS[n % 7];
      if (name) days.push(name);
    }
    if (days.length > 0) return `${days.join('/')} · ${timeStr}`;
  }
  return cron;
}
