/**
 * ReplyShapePanel — is the layered voice working? Median / p90 reply words,
 * the share of replies carrying raw ids vs ref links, and reports per day,
 * over the last 7 and 30 days (`companion_reply_shape_stats`).
 *
 * Absent means not measured: a `null` measure renders as a dash via
 * `Numeric`, never as 0 (contract: docs/features/companion/layered-voice.md).
 * Static chrome always renders; the value cells ghost only while the first
 * read is in flight. A single-slot module cache keeps a remount warm.
 */

import { useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { companionReplyShapeStats } from '@/api/companion';
import type { ReplyShapeStats } from '@/lib/bindings/ReplyShapeStats';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { NumericUnit } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

const WINDOWS = [7, 30] as const;
type Pair = { week: ReplyShapeStats; month: ReplyShapeStats };
let warm: Pair | null = null;

/** Test hatch. */
export function __resetReplyShapeCacheForTests(): void {
  warm = null;
}

type Measure = { key: 'medianWords' | 'p90Words' | 'idRate' | 'refRate' | 'reportsPerDay'; unit: NumericUnit; precision?: number };

const MEASURES: Measure[] = [
  { key: 'medianWords', unit: 'count', precision: 0 },
  { key: 'p90Words', unit: 'count', precision: 0 },
  { key: 'idRate', unit: 'ratio', precision: 0 },
  { key: 'refRate', unit: 'ratio', precision: 0 },
  { key: 'reportsPerDay', unit: 'plain', precision: 1 },
];

export function ReplyShapePanel() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const [data, setData] = useState<Pair | null>(warm);

  useEffect(() => {
    let alive = true;
    Promise.all([companionReplyShapeStats(WINDOWS[0]), companionReplyShapeStats(WINDOWS[1])])
      .then(([week, month]) => {
        if (!alive) return;
        warm = { week, month };
        setData(warm);
      })
      .catch(silentCatch('companion_reply_shape_stats'));
    return () => {
      alive = false;
    };
  }, []);

  const label: Record<Measure['key'], string> = {
    medianWords: c.reply_shape_median_words,
    p90Words: c.reply_shape_p90_words,
    idRate: c.reply_shape_id_rate,
    refRate: c.reply_shape_ref_rate,
    reportsPerDay: c.reply_shape_reports_per_day,
  };

  const cell = (stats: ReplyShapeStats | undefined, m: Measure) =>
    stats ? (
      <Numeric value={stats[m.key]} unit={m.unit} precision={m.precision} className="typo-body tabular-nums text-foreground" />
    ) : (
      <span className="block h-4 w-10 rounded-card bg-primary/[0.06] animate-fade-in" aria-hidden />
    );

  return (
    <section className="space-y-2" data-testid="companion-reply-shape-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <MessageSquareText className="w-4 h-4 text-primary" aria-hidden />
        <h4 className="typo-heading text-foreground/90">{c.reply_shape_title}</h4>
        <span className="typo-caption text-foreground">{c.reply_shape_hint}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-1.5 items-baseline rounded-card border border-primary/10 bg-secondary/20 px-3 py-2">
        <span />
        {WINDOWS.map((d) => (
          <span key={d} className="typo-caption text-foreground text-right">
            {tx(c.reply_shape_window, { days: d })}
          </span>
        ))}
        <span />
        {[data?.week, data?.month].map((s, i) => (
          <span key={i} className="typo-caption text-foreground text-right tabular-nums">
            {s ? tx(c.reply_shape_turns, { count: s.turns }) : ' '}
          </span>
        ))}
        {MEASURES.map((m) => (
          <div key={m.key} className="contents">
            <span className="typo-body text-foreground truncate">{label[m.key]}</span>
            <span className="text-right">{cell(data?.week, m)}</span>
            <span className="text-right">{cell(data?.month, m)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
