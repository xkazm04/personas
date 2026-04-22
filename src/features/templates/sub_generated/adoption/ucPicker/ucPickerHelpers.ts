// Pure helpers for the use-case picker:
//   • summarizeTrigger — short human summary of a TriggerSelection
//   • parseTriggerDisplay — full display model for the TIME card
//   • splitSummary — break a summary into two lines (used in postmark)
//   • classifyEvent — map event type names to the StampKind enum
// All functions are pure / side-effect free so they can be unit-tested
// in isolation.

import { WEEKDAYS, type TriggerSelection } from '../useCasePickerShared';
import type { StampKind, TriggerDisplay } from './ucPickerTypes';

export function summarizeTrigger(sel: TriggerSelection): string {
  if (!sel.time && !sel.event) return 'MANUAL';
  if (sel.event && !sel.time) {
    return sel.event.eventType
      ? `ON ${sel.event.eventType.split('.').pop()?.toUpperCase()}`
      : 'ON EVENT';
  }
  const t = sel.time!;
  if (t.preset === 'hourly') return 'EVERY HR';
  if (t.preset === 'daily') {
    return `DAILY ${String(t.hourOfDay ?? 9).padStart(2, '0')}:00`;
  }
  const wd = WEEKDAYS[t.weekday ?? 1] ?? 'Mon';
  return `${wd.toUpperCase()} ${String(t.hourOfDay ?? 9).padStart(2, '0')}:00`;
}

export function parseTriggerDisplay(sel: TriggerSelection): TriggerDisplay {
  const hasT = !!sel.time;
  const hasE = !!sel.event;
  if (!hasT && !hasE) {
    return {
      primary: 'MANUAL',
      secondary: '—:—',
      detail: 'run on demand',
      mode: 'manual',
      hour: 12,
      weekday: null,
    };
  }
  if (hasE && !hasT) {
    const et = sel.event?.eventType ?? '—';
    const tail = et.split('.').pop() ?? et;
    return {
      primary: 'ON EVENT',
      secondary: tail.toUpperCase(),
      detail: et,
      mode: 'event',
      hour: 12,
      weekday: null,
    };
  }
  const t = sel.time!;
  const hour = t.hourOfDay ?? 9;
  const hhmm = `${String(hour).padStart(2, '0')}:00`;
  if (t.preset === 'hourly') {
    return {
      primary: 'HOURLY',
      secondary: ':00',
      detail: 'every 60 min',
      mode: hasE ? 'both' : 'time',
      hour: 0,
      weekday: null,
    };
  }
  if (t.preset === 'daily') {
    return {
      primary: 'DAILY',
      secondary: hhmm,
      detail: 'every day',
      mode: hasE ? 'both' : 'time',
      hour,
      weekday: null,
    };
  }
  const weekday = t.weekday ?? 1;
  const wd = (WEEKDAYS[weekday] ?? 'Mon').toUpperCase();
  return {
    primary: wd,
    secondary: hhmm,
    detail: 'every week',
    mode: hasE ? 'both' : 'time',
    hour,
    weekday,
  };
}

export function splitSummary(s: string): { a: string; b: string } {
  const parts = s.split(' ');
  if (parts.length === 1) return { a: s, b: '' };
  const mid = Math.ceil(parts.length / 2);
  return {
    a: parts.slice(0, mid).join(' '),
    b: parts.slice(mid).join(' '),
  };
}

export function classifyEvent(eventType: string): StampKind {
  const t = eventType.toLowerCase();
  if (t.endsWith('.buy') || t.includes('.up') || t.includes('discovered')) return 'up';
  if (t.endsWith('.sell') || t.includes('.down') || t.includes('filtered_out') || t.includes('failed')) return 'down';
  if (t.endsWith('.hold') || t.includes('succeeded') || t.includes('completed')) return 'hold';
  if (t.includes('scan') || t.includes('disclosure')) return 'scan';
  if (t.includes('gem')) return 'gem';
  if (t.includes('shift') || t.includes('spike')) return 'spike';
  return 'bolt';
}
