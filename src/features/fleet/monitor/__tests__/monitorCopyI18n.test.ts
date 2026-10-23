import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { buildMonitorModel } from '../monitorModel';
import { resolveCompact } from '../channels/MergedRow';
import { authorName, type LiveMessage } from '../live/liveModel';
import { authorName as channelAuthorName, channelCopyLabels } from '@/features/teams/sub_collab/collabRender';
import type { Translations } from '@/i18n/generated/types';

const LOCALES = ['en', 'ar', 'bn', 'cs', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];
const KEYS = [
  'live_author_you', 'live_author_athena', 'live_author_director',
  'live_event_directive', 'live_event_memory', 'orphan_unassigned', 'orphan_unknown_persona',
  'live_step_created', 'live_step_running', 'live_step_done', 'live_step_failed', 'live_step_skipped',
  'live_step_awaiting_review', 'live_step_mission_done', 'live_step_rework', 'live_step_paused', 'live_event_channel',
];

const cs = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/cs.json'), 'utf8')) as { monitor: Record<string, string> };
// A Czech catalog, read the way the app reads it: the monitor section of the active locale.
const csT = { monitor: cs.monitor } as unknown as Pick<Translations, 'monitor'>;
const row = { id: 'i', at: '2026-01-01T00:00:00Z', body: 'b', label: 'x', extra: null, personaId: null };

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
    const labels = { ...channelCopyLabels(csT), directive: 'pokyn', memory: 'paměť · {label}' };
    const base = { ...row, label: 'fact' };
    expect(resolveCompact({ ...base, kind: 'directive' } as unknown as TeamChannelItem, labels).event).toBe('pokyn');
    expect(resolveCompact({ ...base, kind: 'memory' } as unknown as TeamChannelItem, labels).event).toBe('paměť · fact');
  });

  it('words step verbs and author voices from a non-English catalog', () => {
    const labels = channelCopyLabels(csT);
    const step = (label: string) => resolveCompact({ ...row, kind: 'step', label } as unknown as TeamChannelItem, labels).event;
    expect(step('step_running')).toBe('spuštěno');
    expect(step('status_awaiting_review')).toBe('čeká na vaši kontrolu');
    expect(step('paused')).toBe('pozastaveno');
    const voice = (kind: string) => resolveCompact({ ...row, kind } as unknown as TeamChannelItem, labels).event;
    expect(voice('persona')).toBe('kanál');
    expect(voice('athena')).toBe(cs.monitor.live_author_athena);
    expect(voice('director')).toBe(cs.monitor.live_author_director);
    expect(voice('slack')).toBe('Slack');
  });

  it('names the Timeline authors from a non-English catalog', () => {
    const labels = channelCopyLabels(csT);
    const who = (kind: string) => channelAuthorName({ ...row, kind } as unknown as TeamChannelItem, undefined, labels);
    expect(who('directive')).toBe(cs.monitor.live_author_you);
    expect(who('athena')).toBe(cs.monitor.live_author_athena);
    expect(who('director')).toBe(cs.monitor.live_author_director);
    expect(who('machine')).toBe(cs.monitor.system);
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
