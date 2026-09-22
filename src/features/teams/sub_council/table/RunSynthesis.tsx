// What the run says ABOUT ITSELF: the list it must address, and the one
// sentence it concluded.
//
// Neither was rendered anywhere until the first real council run put them in
// the store, and both arrive in shapes the UI has to survive rather than
// trust. `must_address` is a JSON array of strings written by the ingest
// door; the skill clamps generated lines to 200 characters as of council
// 0.3.0, but the kp run already stored a 1,269-character entry and runs are
// never rewritten - so old data is the normal case, not the edge one. Every
// item is therefore a ONE-LINE item, clamped to two lines with the whole text
// on hover.
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import type { Seat } from './runModel';

/** Trailing punctuation and case are not a difference worth reprinting for. */
function normalise(line: string): string {
  return line.trim().replace(/[.!?:;]+$/, '').toLowerCase();
}

/**
 * The items, minus the ones that just repeat a finding the page already
 * shows.
 *
 * On the kp run one `must_address` entry was word for word a finding title
 * printed a few centimetres above it. Reprinting it is not emphasis, it is
 * the page saying the same thing twice and making the list look longer than
 * the work is. What was dropped is COUNTED and said, which is this page's
 * standing rule about anything it withholds.
 */
export function dedupeMustAddress(
  mustAddressJson: string,
  seats: Seat[],
): { items: string[]; deduped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(mustAddressJson) as unknown;
  } catch {
    // A blob that will not parse is an empty list, never a fabricated one
    // (census `fabricated-json-on-parse-failure`).
    return { items: [], deduped: 0 };
  }
  if (!Array.isArray(raw)) return { items: [], deduped: 0 };
  const titles = new Set(seats.flatMap((s) => s.findings.map((f) => normalise(f.title))));
  const items: string[] = [];
  let deduped = 0;
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const line = entry.trim();
    if (line.length === 0) continue;
    if (titles.has(normalise(line))) {
      deduped += 1;
      continue;
    }
    items.push(line);
  }
  return { items, deduped };
}

export interface SynthesisWords {
  must_address_heading: string;
  must_address_deduped: string;
}

export function MustAddressList({
  mustAddressJson,
  seats,
  words,
  tx,
}: {
  mustAddressJson: string;
  seats: Seat[];
  words: SynthesisWords;
  tx: (template: string, vars: Record<string, string | number>) => string;
}) {
  const { items, deduped } = dedupeMustAddress(mustAddressJson, seats);
  if (items.length === 0 && deduped === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="council-must-address">
      <h3 className="m-0 typo-label text-muted">{words.must_address_heading}</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((line) => (
          <li key={line} className="flex items-baseline gap-2">
            <i aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-status-warning" />
            {/* One line of work, not a wall of prose. The full text is one
                hover away; clamping it is what makes the LIST readable as a
                list. */}
            <Tooltip content={line}>
              <span className="line-clamp-2 typo-body text-foreground">{line}</span>
            </Tooltip>
          </li>
        ))}
      </ul>
      {deduped > 0 ? (
        <p className="m-0 typo-caption text-muted-dark" data-testid="council-must-address-deduped">
          {tx(words.must_address_deduped, { count: deduped })}
        </p>
      ) : null}
    </section>
  );
}
