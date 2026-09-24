/**
 * SetupVoiceControls — mic / speaker / hands-free, in the Setup title row.
 *
 * It lives beside the shell rather than inside the Desk because voice is a
 * property of the SESSION, not of the surface rendering it: dictation and the
 * spoken question keep working while the drawer or the batch studio is open.
 *
 * It never spins and never silently vanishes: with no speech engine the
 * controls stay in place, disabled, saying so in one line.
 */

import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupVoiceApi } from './setupContract';

export function SetupVoiceControls({ voice }: { voice: SetupVoiceApi }) {
  const { t } = useTranslation();
  const v = t.twin.setup.voice;

  if (!voice.supported) {
    return (
      <div className="flex items-center gap-2" data-testid="setup-voice-unsupported">
        <Button variant="ghost" size="icon-sm" disabled disabledReason={v.unsupported} aria-label={v.dictate}
          icon={<MicOff className="w-4 h-4" />} />
        <span className="hidden lg:inline typo-caption">{v.unsupported}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" data-testid="setup-voice-controls">
      <Button
        variant={voice.listening ? 'accent' : 'ghost'} tone="agent" size="icon-sm"
        aria-pressed={voice.listening} aria-label={voice.listening ? v.stop : v.dictate}
        onClick={voice.listening ? voice.stop : voice.start}
        className={voice.listening ? 'ring-2 ring-status-error/40' : ''}
        icon={<Mic className={`w-4 h-4 ${voice.listening ? 'text-status-error' : ''}`} />}
      />
      <Button
        variant={voice.speakEnabled ? 'accent' : 'ghost'} tone="agent" size="icon-sm"
        aria-pressed={voice.speakEnabled} aria-label={voice.speakEnabled ? v.speak : v.speakOff}
        onClick={voice.toggleSpeak}
        icon={voice.speakEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      />
      <AccessibleToggle size="sm" checked={voice.handsFree} onChange={voice.toggleHandsFree} label={v.handsFree} />
      <span className="typo-caption hidden xl:inline">{v.handsFree}</span>
      {voice.error && <span className="typo-caption text-status-error truncate max-w-[24ch]">{voice.error}</span>}
    </div>
  );
}

export default SetupVoiceControls;
