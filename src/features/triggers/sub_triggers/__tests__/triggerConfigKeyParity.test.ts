/**
 * Every key the trigger form writes into a config must be a key the engine
 * reads for that trigger type.
 *
 * A per-type config is stored as unparsed JSON, so a misspelled key never fails
 * at create time - it fails silently on every later run (the polling writer
 * once wrote `endpoint` where `TriggerConfig::from_raw` reads `url`, and the
 * poller skipped every tick). The reader is parsed out of
 * `core/src/models/trigger.rs` at run time, so a rename on either side turns
 * this red. Lives under __tests__/, which tsc skips (node:fs).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getActiveTranslations, preloadSectionsAsync } from '@/i18n/useTranslation';
import { buildTriggerConfig, type TriggerFormState } from '../configs/buildTriggerConfig';

/** Keys written on purpose although no engine reader exists, with the reason. */
const KNOWN_UNREAD: Record<string, string[]> = {
  // Recorded beside `url` for the credential-event picker; the engine has no
  // reader (see the comment in buildTriggerConfig's polling branch).
  polling: ['event_id'],
};

function readerKeys(): Map<string, Set<string>> {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/trigger.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf('pub fn from_raw(');
  expect(start, 'TriggerConfig::from_raw not found').toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf('\n    }\n', start));
  const common = new Set([...body.slice(0, body.indexOf('match trigger_type')).matchAll(/val\s*\.get\("(\w+)"\)/g)].map((m) => m[1]!));
  const arms = [...body.matchAll(/"(\w+)"\s*=>\s*TriggerConfig::/g)];
  const out = new Map<string, Set<string>>();
  arms.forEach((arm, i) => {
    const end = i + 1 < arms.length ? arms[i + 1]!.index! : body.indexOf('_ => TriggerConfig::Unknown');
    const keys = new Set(common);
    for (const m of body.slice(arm.index!, end).matchAll(/val\s*\.get\("(\w+)"\)/g)) keys.add(m[1]!);
    out.set(arm[1]!, keys);
  });
  expect(out.size, 'no trigger-type arms parsed from from_raw').toBeGreaterThan(5);
  return out;
}

function fullForm(triggerType: string): TriggerFormState {
  return {
    triggerType, scheduleMode: 'cron', interval: '300', cronExpression: '0 9 * * 1-5',
    cronPreview: null, scheduleTimezone: 'Europe/Prague', scheduleMaxBackfill: 5,
    endpoint: 'https://example.com/feed', selectedEventId: 'evt-1', hmacSecret: 'secret',
    listenEventType: 'file_changed', sourceFilter: 'watcher-*', watchPaths: ['/tmp/a'],
    watchEvents: ['create', 'modify'], watchRecursive: true, globFilter: '*.md',
    clipboardContentType: 'text', clipboardPattern: 'https?://', clipboardInterval: '5',
    appNames: ['Code.exe'], titlePattern: '.*', appFocusInterval: '3',
    compositeConditions: [{ event_type: 'a' }, { event_type: 'b', source_filter: 'x' }],
    compositeOperator: 'sequence', windowSeconds: '60',
  };
}

const FORM_TYPES = ['schedule', 'polling', 'webhook', 'event_listener', 'file_watcher', 'clipboard', 'app_focus', 'composite'];

beforeAll(async () => {
  await preloadSectionsAsync('en', ['triggers']);
});

describe('trigger form config keys match the engine reader', () => {
  const readers = readerKeys();

  it.each(FORM_TYPES)('%s: every written key has a reader', (type) => {
    const reader = readers.get(type);
    expect(reader, `from_raw has no arm for ${type}`).toBeDefined();
    const variants: TriggerFormState[] = [fullForm(type)];
    if (type === 'schedule') variants.push({ ...fullForm(type), scheduleMode: 'interval' });
    for (const form of variants) {
      const result = buildTriggerConfig(form, getActiveTranslations());
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const written = Object.keys((result as { config: Record<string, unknown> }).config);
      expect(written.length).toBeGreaterThan(0);
      const unread = written.filter((k) => !reader!.has(k) && !(KNOWN_UNREAD[type] ?? []).includes(k));
      expect(unread, `${type} writes keys the engine never reads`).toEqual([]);
    }
  });

  it('each KNOWN_UNREAD key is still unread (an exemption that gained a reader must go)', () => {
    for (const [type, keys] of Object.entries(KNOWN_UNREAD)) {
      for (const k of keys) expect(readers.get(type)?.has(k), `${type}.${k} now has a reader`).toBe(false);
    }
  });
});
