import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import { Unmeasured } from './Lettering';

type Knowledge = TwinBlueprintModel['knowledge'];
type Part = 'approved' | 'awaiting' | 'rejected';

const FILL: Record<Part, string> = { approved: '', awaiting: 'twd-hatch-ink', rejected: '' };

/**
 * Stage mode's knowledge: the three memory counts as one composition bar
 * (shares of all memories, a part of a whole) with a key line per count. A
 * count the source could not read hatches the whole bar and says so.
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
    <div className="flex flex-col gap-2" data-measured={known ? 'true' : 'false'}>
      {!known ? (
        <Unmeasured className="h-3.5 w-full" />
      ) : whole === 0 ? (
        <span className="block h-3.5 w-full" style={{ border: '1px dashed var(--ink-dim)' }} />
      ) : (
        <span className="flex h-3.5 w-full" style={{ border: '1px solid var(--ink)' }}>
          {parts.map((p) =>
            p.n ? <span key={p.part} className={FILL[p.part]} style={{ width: `${(p.n / whole) * 100}%`, ...swatch(p.part) }} /> : null,
          )}
        </span>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <li key={p.part} className="flex items-center gap-1.5" data-measured={p.n === null ? 'false' : 'true'}>
            <span aria-hidden className={`h-3 w-3 shrink-0 ${FILL[p.part]}`} style={{ border: '1px solid var(--ink)', ...swatch(p.part) }} />
            <span className="typo-label text-foreground">{p.label}</span>
            {p.n === null ? <span className="typo-label">-</span> : <Numeric value={p.n} className="typo-label text-foreground" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function swatch(part: Part) {
  if (part === 'approved') return { background: 'var(--ink)' };
  if (part === 'rejected') return { background: 'transparent', borderRight: '1px solid var(--ink-dim)' };
  return {};
}
