import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { buildMonitorModel } from '../monitorModel';
import { resolveCompact } from '../channels/MergedRow';
import { authorName, type LiveMessage } from '../live/liveModel';

const LOCALES = ['en', 'ar', 'bn', 'cs', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];
const KEYS = [
  'live_author_you', 'live_author_athena', 'live_author_director',
  'live_event_directive', 'live_event_memory', 'orphan_unassigned', 'orphan_unknown_persona',
];

describe('monitor model copy comes from the caller, not from literals', () => {
  it('names an orphan message card with the supplied labels', () => {
    const msg = { id: 'm1', persona_id: '' } as unknown as PersonaReport;
    const m = buildMonitorModel([], [], [msg], {}, {}, undefined, { unassigned: 'Nezařazeno', unknownPersona: 'Neznámá' });
    expect(m.cards.map((c) => c.personaName)).toEqual(['Nezařazeno']);
  });

  it('names a live author with the supplied labels', () => {
    const labels = { you: 'Vy', athena: 'Atena', director: 'Ředitel' };
    expect(authorName({ kind: 'directive' } as LiveMessage, labels)).toBe('Vy');
    expect(authorName({ kind: 'athena' } as LiveMessage, labels)).toBe('Atena');
    expect(authorName({ kind: 'director' } as LiveMessage, labels)).toBe('Ředitel');
  });

  it('labels directive and memory rows with the supplied copy', () => {
    const labels = { directive: 'pokyn', memory: 'paměť · {label}' };
    const base = { id: 'i', at: '2026-01-01T00:00:00Z', body: 'b', label: 'fact', extra: null, personaId: null };
    expect(resolveCompact({ ...base, kind: 'directive' } as unknown as TeamChannelItem, labels).event).toBe('pokyn');
    expect(resolveCompact({ ...base, kind: 'memory' } as unknown as TeamChannelItem, labels).event).toBe('paměť · fact');
  });

  it('has every monitor key in all 14 locales', () => {
    for (const code of LOCALES) {
      const json = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${code}.json`), 'utf8')) as {
        monitor: Record<string, string>;
      };
      for (const k of KEYS) expect(json.monitor[k], `${code}.monitor.${k}`).toBeTruthy();
    }
  });
});
