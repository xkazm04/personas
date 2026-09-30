import { Mic, Play, Square } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { MicLevelMeter } from '../../shared/MicLevelMeter';
import { AthenaWaveform } from '../../shared/AthenaWaveform';
import { StageCardInstall } from '../stage/StageCardEngine';
import { TableOpt } from './TableCardChoice';

/**
 * The cards you listen to: her voices as takes (hear, then choose), your
 * voice heard two ways as a first and a second take, and the install that
 * brings her voice onto the machine.
 */
type CardOf<K extends CreateAthenaCard['kind']> = Extract<CreateAthenaCard, { kind: K }>;

export function TableCardVoice({ engine, card }: { engine: CreateAthenaEngine; card: CardOf<'voice_pick'> }) {
  const { t } = useTranslation();
  const c = t.athena;
  if (card.voices.length === 0) {
    return <p className="tb-card-hint typo-body" data-testid="create-athena-voice-none">{card.loading ? c.table_status_installing : c.create_voice_none}</p>;
  }
  return (
    <div className={`tb-takes ${card.voices.length === 1 ? 'one' : ''}`} role="radiogroup" aria-label={c.create_step_voice_pick}>
      {card.voices.map((v, i) => {
        const mine = card.previewVoiceId === v.voiceId;
        const playing = mine && card.preview === 'playing';
        const selected = card.selected === v.voiceId;
        return (
          <div key={v.voiceId} className={`tb-take ${playing ? 'playing' : ''} ${selected ? 'picked' : ''}`} data-testid={`create-athena-voice-${v.voiceId}`} data-selected={selected ? 'true' : 'false'}>
            <TableOpt n={i + 1} title={v.label} desc={v.meta ?? undefined} pressed={selected} onPick={() => engine.actions.selectVoice(v.voiceId)} testId={`create-athena-voice-select-${v.voiceId}`} />
            <div className="tb-take-row typo-body">
              <Button
                variant="secondary"
                size="sm"
                loading={mine && card.preview === 'synth'}
                icon={playing ? <Square className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
                onClick={() => (playing ? engine.actions.stopPreview() : engine.actions.previewVoice(v.voiceId))}
                data-testid={`create-athena-voice-play-${v.voiceId}`}
              >
                {playing ? c.create_voice_stop : c.create_voice_play}
              </Button>
              <AthenaWaveform active={playing} bars={28} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TableCardStt({ engine, card }: { engine: CreateAthenaEngine; card: CardOf<'stt'> }) {
  const { t, tx } = useTranslation();
  const c = t.athena;
  const cols = [
    { id: 'browser' as const, cls: 'first', name: c.create_stt_browser, take: card.browser, installed: true },
    { id: 'whisper' as const, cls: 'second', name: c.create_stt_whisper, take: card.whisper, installed: card.whisperInstalled },
  ];
  return (
    <>
      {card.micError && <p className="tb-card-hint typo-body" data-testid="create-athena-stt-mic-error">{card.micError}</p>}
      <div className="tb-toggle typo-body">
        <Button
          variant={card.recording ? 'primary' : 'secondary'}
          size="md"
          icon={<Mic className="w-4 h-4" aria-hidden="true" />}
          aria-pressed={card.recording}
          onPointerDown={engine.actions.sttStart}
          onPointerUp={engine.actions.sttStop}
          onPointerLeave={card.recording ? engine.actions.sttStop : undefined}
          onPointerCancel={engine.actions.sttStop}
          disabled={card.busy && !card.recording}
          data-testid="create-athena-stt-hold"
        >
          {card.recording ? c.create_stt_release : c.create_stt_hold}
        </Button>
        <MicLevelMeter active={card.recording} className="flex-1" />
      </div>
      <div className="tb-takes">
        {cols.map((col, i) => {
          const usable = col.take.supported && col.installed;
          const heard = col.take.text || col.take.interim;
          const body = col.take.error ?? (!col.take.supported ? c.create_stt_unsupported : !col.installed ? c.create_stt_not_installed : heard || (card.recording ? c.create_stt_listening : c.create_stt_empty));
          return (
            <div key={col.id} className={`tb-take ${col.cls} ${card.picked === col.id ? 'picked' : ''} ${usable ? '' : 'muted'}`} data-testid={`create-athena-stt-col-${col.id}`}>
              <div className="tb-take-lab typo-heading">
                <i aria-hidden="true" />
                {col.name}
                {col.take.elapsedMs !== null && <span className="tb-card-step typo-body">{tx(c.create_stt_latency, { ms: col.take.elapsedMs })}</span>}
              </div>
              <p className="tb-take-body typo-body" data-testid={`create-athena-stt-text-${col.id}`}>{body}</p>
              <TableOpt n={i + 1} title={c.create_stt_use} pressed={card.picked === col.id} onPick={() => usable && engine.actions.sttPick(col.id)} testId={`create-athena-stt-use-${col.id}`} />
            </div>
          );
        })}
      </div>
    </>
  );
}

export function TableCardInstall({ engine, card }: { engine: CreateAthenaEngine; card: CardOf<'install'> }) {
  const { t } = useTranslation();
  const c = t.athena;
  const s = card.state;
  const busy = s.phase === 'downloading_engine' || s.phase === 'downloading_model' || s.phase === 'extracting';
  if (!busy) return <StageCardInstall card={card} actions={engine.actions} />;
  const pct = s.bytesTotal ? Math.min(100, Math.round((s.bytesDownloaded / s.bytesTotal) * 100)) : null;
  const phase = s.phase === 'downloading_engine' ? c.create_install_phase_engine : s.phase === 'downloading_model' ? c.create_install_phase_model : c.create_install_phase_extract;
  return (
    <div data-testid="create-athena-install-progress">
      <div className="tb-take-row typo-body">
        <span>{phase}</span>
        <span className="tb-card-step">
          <Numeric value={pct ?? s.bytesDownloaded / (1024 * 1024)} unit={pct !== null ? 'percent' : undefined} precision={0} />
          {pct === null && ' MB'}
        </span>
      </div>
      <div className="tb-progress"><span style={{ width: `${pct ?? 30}%` }} /></div>
    </div>
  );
}
