/**
 * The Live Stream status filter and status cells speak the whole
 * persona_events vocabulary, read from the Rust enum that writes it.
 * TETHERED to src-tauri/core/src/models/event.rs (PersonaEventStatus::as_str).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import type { Translations } from '@/i18n/useTranslation';
import { EVENT_STATUS_ORDER, eventStatusLabel, eventStatusLabels } from '../eventStatusLabels';

const t: Translations = en;

function rustEventStatuses(): string[] {
  const src = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/event.rs'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  const body = src.match(/pub fn as_str\(&self\) -> &'static str \{\s*match self \{([\s\S]*?)\n\s*\}\s*\n\s*\}/)?.[1];
  expect(body, 'PersonaEventStatus::as_str not found').toBeDefined();
  return [...body!.matchAll(/=>\s*"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe('live stream event status vocabulary', () => {
  it('offers every status the backend writes, including delivered', () => {
    const rust = rustEventStatuses();
    expect(rust).toContain('delivered');
    expect(new Set(EVENT_STATUS_ORDER)).toEqual(new Set(rust));
    expect(EVENT_STATUS_ORDER).toHaveLength(rust.length);
  });

  it('labels every status with catalog copy, never the raw token', () => {
    const labels = eventStatusLabels(t);
    for (const status of EVENT_STATUS_ORDER) {
      expect(typeof labels[status], status).toBe('string');
      expect(labels[status].length, status).toBeGreaterThan(0);
    }
    expect(eventStatusLabel(t, 'delivered')).toBe('Delivered');
    expect(eventStatusLabel(t, 'dead_letter')).not.toBe('dead_letter');
  });

  it('renders an unknown token as itself rather than blank', () => {
    expect(eventStatusLabel(t, 'processed')).toBe('processed');
  });
});
