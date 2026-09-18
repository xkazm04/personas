/**
 * Next-fire evaluation for the 5-field cron expressions this app schedules on,
 * in a named IANA zone.
 *
 * Why this exists: `CRON_PRESETS` label a preset by its wall-clock time and
 * deliberately omit a zone suffix, because the backend evaluates the cron in
 * the trigger's configured timezone. That is correct for a label and useless
 * for a preview - "Daily 9am" looks identical whether the trigger runs in the
 * operator's zone or a stale one carried over from another machine. A wrong
 * timezone therefore looks exactly like the right preset. This module answers
 * the question the label dodges: *when does it actually fire next*.
 *
 * No dependency: the evaluation walks the CIVIL calendar in the target zone
 * (pure integer arithmetic) and converts the winning wall-clock back to an
 * instant through `Intl.DateTimeFormat`, so it costs a handful of formats per
 * call rather than one per candidate minute.
 */

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** Standard cron: when BOTH day fields are restricted the match is an OR. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

/** Parse one cron field ("*", "*\/5", "1-5", "0,9,17", "1-5/2") into a set. */
function parseField(raw: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    if (part === '') return null;
    const [spec = '', stepRaw] = part.split('/');
    if (stepRaw !== undefined && !/^\d+$/.test(stepRaw)) return null;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (step < 1) return null;

    let lo: number;
    let hi: number;
    if (spec === '*') {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(spec)) {
      lo = Number(spec);
      hi = stepRaw === undefined ? lo : max;
    } else {
      const range = spec.match(/^(\d+)-(\d+)$/);
      if (!range) return null;
      lo = Number(range[1]);
      hi = Number(range[2]);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

/** Parse a 5-field cron expression. Returns null when it is not one. */
export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min = '', hr = '', dom = '', mon = '', dow = ''] = parts;

  const minutes = parseField(min, 0, 59);
  const hours = parseField(hr, 0, 23);
  const daysOfMonth = parseField(dom, 1, 31);
  const months = parseField(mon, 1, 12);
  const rawDow = parseField(dow, 0, 7);
  if (!minutes || !hours || !daysOfMonth || !months || !rawDow) return null;

  // Cron accepts 7 as Sunday alongside 0.
  const daysOfWeek = new Set<number>();
  for (const d of rawDow) daysOfWeek.add(d === 7 ? 0 : d);

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

interface CivilTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = PART_FORMATTERS.get(timeZone);
  if (cached) return cached;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PART_FORMATTERS.set(timeZone, fmt);
    return fmt;
  } catch {
    // An unknown zone is a caller mistake, not a crash.
    return null;
  }
}

/** The wall clock an instant reads as in `timeZone`. */
function civilIn(instant: number, fmt: Intl.DateTimeFormat): CivilTime & { second: number } {
  const parts = fmt.formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Zone offset in ms at `instant` (zone wall clock minus UTC). */
function offsetAt(instant: number, fmt: Intl.DateTimeFormat): number {
  const c = civilIn(instant, fmt);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - instant;
}

/**
 * The instant at which `civil` reads on the wall clock in `timeZone`.
 * Two passes: guess with the offset at the naive UTC point, then correct with
 * the offset actually in force there, which is what handles a DST boundary.
 */
function civilToInstant(civil: CivilTime, fmt: Intl.DateTimeFormat): number {
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, 0);
  let instant = naive - offsetAt(naive, fmt);
  instant = naive - offsetAt(instant, fmt);
  return instant;
}

function dayOfWeek(civil: CivilTime): number {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayMatches(fields: CronFields, civil: CivilTime): boolean {
  if (!fields.months.has(civil.month)) return false;
  const dom = fields.daysOfMonth.has(civil.day);
  const dow = fields.daysOfWeek.has(dayOfWeek(civil));
  if (fields.domRestricted && fields.dowRestricted) return dom || dow;
  if (fields.domRestricted) return dom;
  if (fields.dowRestricted) return dow;
  return true;
}

/** How far ahead the search gives up, in days. Covers every preset shape. */
const SEARCH_HORIZON_DAYS = 4 * 366;

/**
 * The next instant at which `cron` fires in `timezone`, strictly after `from`.
 *
 * @param cron 5-field expression (minute hour day-of-month month day-of-week).
 * @param timezone IANA zone the cron is evaluated in. `undefined` means
 *   system-local, matching the backend's own fallback.
 * @param from the moment to search forward from (defaults to now).
 * @returns the next fire, or `null` when the expression or zone is unusable or
 *   nothing matches inside the search horizon (e.g. `0 0 30 2 *`).
 */
export function nextFireAt(cron: string, timezone?: string, from: Date = new Date()): Date | null {
  const fields = parseCron(cron);
  if (!fields) return null;
  const zone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const fmt = formatterFor(zone);
  if (!fmt) return null;
  const start = from.getTime();
  if (!Number.isFinite(start)) return null;

  const now = civilIn(start, fmt);
  // Candidates are whole minutes, so the first one worth trying is the minute
  // after the one we are standing in.
  const cursor: CivilTime = {
    year: now.year,
    month: now.month,
    day: now.day,
    hour: now.hour,
    minute: now.minute + 1,
  };
  if (cursor.minute > 59) {
    cursor.minute = 0;
    cursor.hour += 1;
    if (cursor.hour > 23) {
      cursor.hour = 0;
      cursor.day += 1;
    }
  }
  normalizeDay(cursor);

  const sortedHours = [...fields.hours].sort((a, b) => a - b);
  const sortedMinutes = [...fields.minutes].sort((a, b) => a - b);

  for (let dayIndex = 0; dayIndex < SEARCH_HORIZON_DAYS; dayIndex += 1) {
    if (dayMatches(fields, cursor)) {
      const fromHour = dayIndex === 0 ? cursor.hour : 0;
      const fromMinute = dayIndex === 0 ? cursor.minute : 0;
      for (const hour of sortedHours) {
        if (hour < fromHour) continue;
        for (const minute of sortedMinutes) {
          if (hour === fromHour && minute < fromMinute) continue;
          const instant = civilToInstant(
            { year: cursor.year, month: cursor.month, day: cursor.day, hour, minute },
            fmt,
          );
          // At a DST fall-back the same wall clock names two instants and the
          // earlier one can already be behind us; never report a fire in the past.
          if (instant > start) return new Date(instant);
        }
      }
    }
    cursor.day += 1;
    cursor.hour = 0;
    cursor.minute = 0;
    normalizeDay(cursor);
  }
  return null;
}

/** Roll an overflowed day-of-month into the following month/year, in place. */
function normalizeDay(civil: CivilTime): void {
  while (civil.day > daysInMonth(civil.year, civil.month)) {
    civil.day -= daysInMonth(civil.year, civil.month);
    civil.month += 1;
    if (civil.month > 12) {
      civil.month = 1;
      civil.year += 1;
    }
  }
}
