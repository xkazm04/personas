/**
 * Every file-watcher event kind the trigger form can write must be one the
 * engine can emit.
 *
 * The form offered a `rename` chip and the NL parser wrote `rename` for "when a
 * file is renamed or moved", but `engine/src/file_watcher.rs` maps the OS event
 * to create / modify / delete and drops the rest (notify reports a rename as
 * Modify(Name)). A trigger whose events were only ["rename"] matched nothing,
 * forever, with nothing anywhere saying so. The engine vocabulary is read from
 * the Rust source so the two cannot drift silently. Lives under __tests__/,
 * which tsc skips (node:fs).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getActiveTranslations, preloadSectionsAsync } from '@/i18n/useTranslation';
import {
  buildTriggerConfig,
  ENGINE_WATCH_EVENTS,
  normalizeWatchEvents,
  type TriggerFormState,
} from '../configs/buildTriggerConfig';
import { parseNaturalLanguageTrigger } from '../nlTriggerParser';

function engineWatchKinds(): string[] {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/engine/src/file_watcher.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf('let kind_str = match event.kind {');
  expect(start, 'kind_str match not found in file_watcher.rs').toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf('};', start));
  const kinds = [...body.matchAll(/EventKind::\w+\(_\)\s*=>\s*"(\w+)"/g)].map((m) => m[1]!);
  expect(kinds.length, 'no kinds parsed from the kind_str match').toBeGreaterThan(0);
  return kinds;
}

function formState(watchEvents: string[]): TriggerFormState {
  return {
    triggerType: 'file_watcher', scheduleMode: 'interval', interval: '', cronExpression: '',
    cronPreview: null, endpoint: '', selectedEventId: '', hmacSecret: '', listenEventType: '',
    sourceFilter: '', watchPaths: ['/tmp/watched'], watchEvents, watchRecursive: true,
    globFilter: '', clipboardContentType: 'text', clipboardPattern: '', clipboardInterval: '',
    appNames: [], titlePattern: '', appFocusInterval: '', compositeConditions: [],
    compositeOperator: 'all', windowSeconds: '',
  };
}

beforeAll(async () => {
  await preloadSectionsAsync('en', ['triggers']);
});

describe('file-watcher event vocabulary matches the engine', () => {
  it('the chip vocabulary is exactly what the engine emits', () => {
    expect([...ENGINE_WATCH_EVENTS].sort()).toEqual(engineWatchKinds().sort());
  });

  it('a rename-only selection is written as a kind the engine emits', () => {
    const result = buildTriggerConfig(formState(['rename']), getActiveTranslations());
    expect(result.ok).toBe(true);
    const events = (result as { config: { events: string[] } }).config.events;
    const engine = engineWatchKinds();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(engine).toContain(e);
  });

  it('collapses duplicates after mapping', () => {
    expect(normalizeWatchEvents(['modify', 'rename', 'create', 'create'])).toEqual(['modify', 'create']);
  });

  it('the NL parser never writes a kind the engine cannot emit', () => {
    const parsed = parseNaturalLanguageTrigger('when I rename a file in /tmp/inbox');
    expect(parsed?.triggerType).toBe('file_watcher');
    const engine = engineWatchKinds();
    const events = parsed?.formOverrides.watchEvents ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(engine).toContain(e);
  });
});
