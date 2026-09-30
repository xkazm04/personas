/**
 * Create Athena "Table" shell: what the person has decided, read from the
 * real store keys (never a local copy), phrased once for both the thread's
 * receipts and the Style Card rail.
 */
import { useShallow } from 'zustand/react/shallow';
import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { CreateAthenaStepId } from '../../engine/createAthenaTypes';

export interface TableFacts {
  footer: boolean;
  orb: boolean;
  chime: boolean;
  engine: string;
  voice: string | null;
  speed: number | null;
  stt: string;
}

/** `af_heart` -> `Heart`; any other id is shown as stored. */
export function voiceLabel(id: string | null): string | null {
  if (!id) return null;
  const m = /^[a-z]{2}_([a-z]+)$/.exec(id);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1) : id;
}

export function useTableFacts(): TableFacts {
  const { t } = useTranslation();
  const c = t.athena;
  const s = useSystemStore(
    useShallow((st) => ({
      footer: st.athenaFooterEnabled,
      orb: st.athenaOrbEnabled,
      chime: st.athenaSoundEnabled,
      engine: st.athenaVoiceEngine,
      kokoro: st.athenaKokoroVoiceId,
      pocket: st.athenaPocketVoiceId,
      speed: st.athenaVoiceSpeed,
      stt: st.athenaSttEngine,
    })),
  );
  return {
    footer: s.footer,
    orb: s.orb,
    chime: s.chime,
    engine: s.engine === 'pocket_tts' ? c.create_engine_pocket_title : c.create_engine_kokoro_title,
    voice: voiceLabel(s.engine === 'pocket_tts' ? s.pocket : s.kokoro),
    speed: s.speed,
    stt: s.stt === 'whisper' ? c.create_stt_whisper : c.create_stt_browser,
  };
}

type Strings = Translations['athena'];

/** The one-line receipt for an answered step, or `null` for steps that fold silently. */
export function receiptText(c: Strings, tx: (s: string, v: Record<string, string | number>) => string, id: CreateAthenaStepId, f: TableFacts): string | null {
  const onOff = (on: boolean) => (on ? c.table_on : c.table_off);
  switch (id) {
    case 'intro':
      return c.table_receipt_hello;
    case 'footer_icon':
      return tx(c.table_receipt_feature, { feature: c.create_step_footer_icon, state: onOff(f.footer) });
    case 'orb':
      return tx(c.table_receipt_feature, { feature: c.create_step_orb, state: onOff(f.orb) });
    case 'orb_place':
      return c.table_receipt_orb_place;
    case 'chime':
      return tx(c.table_receipt_feature, { feature: c.create_step_chime, state: onOff(f.chime) });
    case 'voice_engine':
      return tx(c.table_receipt_engine, { engine: f.engine });
    case 'voice_install':
      return c.table_receipt_installed;
    case 'voice_pick':
      return f.voice ? tx(c.table_receipt_voice, { voice: f.voice }) : null;
    case 'stt':
      return tx(c.table_receipt_stt, { engine: f.stt });
    case 'handoff':
      return null;
  }
}
