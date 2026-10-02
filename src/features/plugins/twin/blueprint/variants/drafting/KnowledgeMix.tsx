import { useTranslation } from '@/i18n/useTranslation';
import type { TwinBlueprintModel } from '../../blueprintContract';
import { Unmeasured } from './Lettering';
import DrawFrame from './draw/DrawFrame';
import Write, { WriteNumber } from './draw/Write';

type Knowledge = TwinBlueprintModel['knowledge'];
type Part = 'approved' | 'awaiting' | 'rejected';

const FILL: Record<Part, string> = { approved: '', awaiting: 'twd-hatch-ink', rejected: '' };

/**
 * Layer one's (and the stage's) knowledge: the three memory counts as one composition bar
 * (shares of all memories, a part of a whole) with a key line per count. A
 * count the source could not read hatches the whole bar and says so. The bar
 * is a frame its segments are laid into one after another; each key line is
 * its own container.
 */
export default function KnowledgeMix({ knowledge }: { knowledge: Knowledge }) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const { approved, pending, rejected } = knowledge.memories;
  const parts: { part: Part; label: string; n: number | null }[] = [
    { part: 'approved', label: m.approved, n: approved },
    { part: 'awaiting', label: m.awaiting, n: pending },
    { part: 'rejected', label: m.rejected, n: rejected },
  ];
  const known = approved !== null && pending !== null && rejected !== null;
  const whole = known ? approved + pending + rejected : 0;

  return (
    <div className="flex flex-col gap-2" data-measured={known ? 'true' : 'false'} data-draw-scope="">
      {!known ? (
        <Unmeasured className="h-3.5 w-full" />
      ) : (
        <span className="relative flex h-3.5 w-full" style={{ border: '1px solid transparent' }}>
          <DrawFrame stroke={whole === 0 ? 'var(--ink-dim)' : 'var(--ink)'} dash={whole === 0 ? '4 3' : undefined} />
          {whole > 0 &&
            parts.map((p) =>
              p.n ? (
                <span
                  key={p.part}
                  data-part={p.part}
                  data-draw={p.part === 'awaiting' ? 'sweep' : 'extend'}
                  className={FILL[p.part]}
                  style={{ width: `${(p.n / whole) * 100}%`, ...swatch(p.part) }}
                />
              ) : null,
            )}
        </span>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <li key={p.part} className="flex items-center gap-1.5" data-part={p.part} data-measured={p.n === null ? 'false' : 'true'} data-draw-scope="">
            <span aria-hidden className="relative h-3 w-3 shrink-0" style={{ border: '1px solid transparent' }}>
              <DrawFrame stroke="var(--ink)" />
              <span data-draw="sweep" className={`absolute inset-0 ${FILL[p.part]}`} style={swatch(p.part)} />
            </span>
            <span className="typo-label text-foreground">
              <Write text={p.label} />
            </span>
            {p.n === null ? (
              <span className="typo-label">
                <Write text="-" />
              </span>
            ) : (
              <WriteNumber value={p.n} className="typo-label text-foreground" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The rejected share is laid in its role's fill (`--twd-rejected-fill`, sheet.css). */
function swatch(part: Part) {
  if (part === 'approved') return { background: 'var(--ink)' };
  if (part === 'rejected') return { background: 'var(--twd-rejected-fill)', borderRight: '1px solid var(--ink-dim)' };
  return {};
}
