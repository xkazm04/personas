/**
 * FORM 3 - settled: flat ledger lines, no card at all.
 *
 * A decision that is over stops asking for attention. What it keeps is who
 * answered it, when, and any disagreement the record itself carries - a
 * warning line is part of the record, never something smoothed out of it.
 */
import type { DocketFeed } from '../model/docket';
import { utcDay } from '../format';
import { useWords } from '../words';

interface SettledProps {
  feed: DocketFeed;
  decided: Record<string, { option: string; reason: string }>;
  selected: string | null;
  onSelect: (id: string) => void;
}

function who(by: string): string {
  if (/grant/i.test(by)) return '⛨';
  if (/operator|you/i.test(by)) return '●';
  return '◌';
}

export function SettledLines({ feed, decided, selected, onSelect }: SettledProps) {
  const { w } = useWords();
  const mine = feed.entries.filter((e) => decided[e.id]);

  return (
    <div className="cb-ledgerlines" data-role="cb-settled">
      {mine.map((entry) => {
        const d = decided[entry.id]!;
        return (
          <div
            key={entry.id}
            className={`cb-lr cb-mine${selected === entry.id ? ' cb-sel' : ''}`}
            role="presentation"
            onClick={() => {
              onSelect(entry.id);
            }}
          >
            <span className="typo-code cb-dim">{w.docket_this_session}</span>
            <span className="cb-who">{'●'}</span>
            <span className="typo-caption">
              <b style={{ color: 'var(--foreground)' }}>{entry.title}</b> {d.option}{' '}
              <span className="cb-dim">{w.docket_by_you}</span>
              {d.reason && <span className="cb-rs">{`“${d.reason}”`}</span>}
            </span>
          </div>
        );
      })}
      {feed.settled.map((row) => (
        <div
          key={row.id}
          className={`cb-lr${selected === row.id ? ' cb-sel' : ''}`}
          role="presentation"
          onClick={() => {
            onSelect(row.id);
          }}
        >
          <span className="typo-code cb-dim">{utcDay(row.decidedAt)}</span>
          <span className="cb-who">{who(row.by)}</span>
          <span className="typo-caption">
            <b style={{ color: 'var(--foreground)' }}>{row.title}</b> {row.decision.replace('_', ' ')}{' '}
            <span className="cb-dim">{row.by}</span>
            {row.detail && <span className="cb-rs">{row.detail}</span>}
            {row.warning && <span className="cb-warnline typo-caption">{row.warning}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
