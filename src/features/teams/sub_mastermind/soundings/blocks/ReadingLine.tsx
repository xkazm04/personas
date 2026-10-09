// The waterline sentence: which project the chart is reading, where it ranks,
// and why it sits that deep. The chart's one piece of prose, so it carries the
// body token and the project name is the only emphasis in it.
import type { ReactNode } from 'react';

import { stationReasons } from '../soundingsModel';
import { useSoundingsModel } from '../context';
import { FILE } from '../useSoundingsNav';

export function ReadingLine() {
  const { n, settling, stations, act, rankOf, liftedKey, nav, words, statusWord } = useSoundingsModel();
  const { m, tx, reasonText } = words;
  const { level, curStation } = nav;

  let reading: ReactNode = settling ? m.loading_projects : null;
  if (n > 0) {
    if (level === 2 && liftedKey && liftedKey !== FILE && curStation) {
      const node = curStation.island.nodes.find((x) => x.key === liftedKey);
      if (node) reading = <><b>{node.label}</b>{` ${tx(m.soundings_reading_dim, { dim: '', project: curStation.island.name, status: statusWord(node.status) }).trimStart()}`}</>;
    } else {
      const s = stations[act];
      // A ghost station has no verdict yet (unsettled or unmeasured): the line
      // must not rank it or call it calm before the data says so.
      if (s?.ghost) reading = m.loading_projects;
      else if (s) {
        const r = rankOf(act);
        const head = r === 0 ? tx(m.soundings_reading_first, { name: '\u0000' }) : tx(m.soundings_reading_nth, { name: '\u0000', rank: r + 1 });
        const [pre, post] = head.split('\u0000');
        const rs = stationReasons(s);
        reading = (
          <>
            {pre}<b>{s.island.name}</b>{post}
            {': '}
            {rs.length === 0 ? m.soundings_calm : rs.map((x, k) => (
              <span key={x.kind}>{k > 0 ? ', ' : ''}<span className={x.kind === 'alerts' ? 'sd-al' : undefined}>{reasonText(x)}</span></span>
            ))}
          </>
        );
      }
    }
  }

  return <p className="sd-reading" aria-live="polite">{reading}</p>;
}
