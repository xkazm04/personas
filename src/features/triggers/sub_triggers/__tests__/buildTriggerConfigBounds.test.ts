/**
 * The trigger form refuses, where the user types it, what the backend would
 * otherwise refuse after submit (composite window above 24 h) or silently
 * widen (a file watcher with no event chip stored `events: []`, which the
 * engine reads as "all events"). The window ceiling is read from the Rust
 * constant so the two cannot drift. Lives under __tests__/ (node:fs).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getActiveTranslations, preloadSectionsAsync } from '@/i18n/useTranslation';
import {
  buildTriggerConfig,
  COMPOSITE_WINDOW_MAX_SECONDS,
  type TriggerFormState,
} from '../configs/buildTriggerConfig';

function state(over: Partial<TriggerFormState>): TriggerFormState {
  return {
    triggerType: 'composite', scheduleMode: 'interval', interval: '', cronExpression: '',
    cronPreview: null, endpoint: '', selectedEventId: '', hmacSecret: '', listenEventType: '',
    sourceFilter: '', watchPaths: ['/tmp/watched'], watchEvents: [], watchRecursive: true,
    globFilter: '', clipboardContentType: 'text', clipboardPattern: '', clipboardInterval: '',
    appNames: [], titlePattern: '', appFocusInterval: '',
    compositeConditions: [{ event_type: 'a' }, { event_type: 'b' }] as TriggerFormState['compositeConditions'],
    compositeOperator: 'all', windowSeconds: '60', ...over,
  };
}

beforeAll(async () => {
  await preloadSectionsAsync('en', ['triggers']);
});

describe('composite window ceiling', () => {
  it('matches MAX_COMPOSITE_WINDOW_SECONDS in core validation', () => {
    const src = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/validation/trigger.rs'), 'utf8');
    const m = src.match(/MAX_COMPOSITE_WINDOW_SECONDS:\s*i64\s*=\s*([\d_]+)/);
    expect(m, 'constant not found').toBeTruthy();
    expect(COMPOSITE_WINDOW_MAX_SECONDS).toBe(Number(m![1]!.replace(/_/g, '')));
  });

  it('accepts the ceiling and refuses one second above it', () => {
    const t = getActiveTranslations();
    expect(buildTriggerConfig(state({ windowSeconds: '86400' }), t).ok).toBe(true);
    const over = buildTriggerConfig(state({ windowSeconds: '86401' }), t);
    expect(over.ok).toBe(false);
  });
});

describe('file watcher with no event selected', () => {
  it('is refused instead of storing events: [] (which the engine reads as all events)', () => {
    const t = getActiveTranslations();
    const r = buildTriggerConfig(state({ triggerType: 'file_watcher', watchEvents: [] }), t);
    expect(r.ok).toBe(false);
  });

  it('still builds with one event', () => {
    const t = getActiveTranslations();
    expect(buildTriggerConfig(state({ triggerType: 'file_watcher', watchEvents: ['create'] }), t).ok).toBe(true);
  });
});
