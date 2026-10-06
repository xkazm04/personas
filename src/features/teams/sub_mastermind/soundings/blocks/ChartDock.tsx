// The dock: whether Athena is steering, the keys that work at THIS level, and
// one reserved row for her latest move. One row, not three - a fixed three-line
// well sat empty most of the time (reserve the row, not the maximum).
import { SonarGlyph } from '../soundingsParts';
import { useSoundingsModel } from '../context';

export function ChartDock() {
  const { nav, words } = useSoundingsModel();
  const { m } = words;
  const { level, busy, log } = nav;

  const keysForLevel: Array<[string[], string]> = [
    [['←', '→', '↑', '↓'], ''],
    ...(level < 2 ? [[['↵'], level === 0 ? m.soundings_key_open : m.soundings_key_lift] as [string[], string]] : []),
    ...(level >= 1 ? [[['I'], m.soundings_key_details] as [string[], string]] : []),
    ...(level >= 1 ? [[['Esc'], m.soundings_key_up] as [string[], string]] : []),
    [['/'], m.soundings_key_find],
    [['A'], m.soundings_key_waiting],
    [['R'], m.soundings_key_related],
    [['?'], m.soundings_key_all],
  ];

  return (
    <footer className="sd-dock">
      <div className="sd-loghead">
        <SonarGlyph />
        <span className="sd-status typo-label">{busy ? m.soundings_athena_moving : m.soundings_athena_idle}</span>
        <div className="sd-keys" aria-hidden>
          {keysForLevel.map(([ks, w]) => (
            <span key={ks.join('')}>{ks.map((x) => <kbd key={x}>{x}</kbd>)}{w}</span>
          ))}
        </div>
      </div>
      <ol className="sd-log" role="log" aria-live="polite" aria-label={m.soundings_log_label}>
        {log.slice(-1).map((l) => (
          <li key={l.id} className={l.who === 'athena' ? 'sd-ath' : undefined}>
            <time>{l.time}</time>
            <b className="typo-label">{l.who === 'athena' ? m.soundings_who_athena : m.soundings_who_chart}</b>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
    </footer>
  );
}
