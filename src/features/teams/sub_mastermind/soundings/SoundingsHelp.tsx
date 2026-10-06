// The '?' sheet: every key, what depth means, and the status legend. Shown in a
// BaseModal from the view; its own file because it shares nothing with the
// chart's state.
import { useTranslation } from '@/i18n/useTranslation';

import { useStatusWord } from './SoundingsCard';
import { FlagGlyph, StatusMark } from './soundingsParts';

export function SoundingsHelp() {
  const { t } = useTranslation();
  const m = t.mastermind;
  const statusWord = useStatusWord();
  const keys: Array<[string[], string]> = [
    [['←', '→'], m.soundings_help_move],
    [['↑', '↓'], m.soundings_help_urgency],
    [['↵'], m.soundings_help_open],
    [['I'], m.soundings_help_file],
    [['Esc'], m.soundings_help_esc],
    [['⇧', '←→'], m.soundings_help_neighbour],
    [['/'], m.soundings_help_find],
    [['A'], m.soundings_help_waiting],
    [['R'], m.soundings_help_related],
    [['H'], m.soundings_help_home],
    [['?'], m.soundings_help_sheet],
  ];
  return (
    <div className="sd-root-vars sd-help">
      <h2 id="sd-help-title" className="typo-heading-lg">{m.soundings_help_title}</h2>
      <div>
        <h3 className="typo-label">{m.soundings_help_keys}</h3>
        <dl>
          {keys.map(([ks, w]) => (
            <div key={w} style={{ display: 'contents' }}>
              <dt>{ks.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{w}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="typo-label">{m.soundings_depth}</h3>
        <p>{m.soundings_help_depth_l0}</p>
        <p>{m.soundings_help_depth_l1}</p>
        <h3 className="typo-label">{m.soundings_help_legend}</h3>
        {(['alert', 'risk', 'absent', 'unknown', 'partial', 'solid'] as const).map((s) => (
          <div key={s} className="sd-lgrow"><StatusMark status={s} />{statusWord(s)}</div>
        ))}
        <p>{m.soundings_unknown_note}</p>
        <div className="sd-lgrow"><FlagGlyph />{m.soundings_help_flag}</div>
      </div>
    </div>
  );
}
