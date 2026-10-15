import { useTranslation } from '@/i18n/useTranslation';
import type { RepoArc } from './dialModel';

const KEY: { o: string; label: 'cap_go' | 'cap_clean' | 'cap_errored' | 'cap_interrupted' | 'cap_stumbled' | 'cap_absent' }[] = [
  { o: 'landed', label: 'cap_go' },
  { o: 'quiet', label: 'cap_clean' },
  { o: 'errored', label: 'cap_errored' },
  { o: 'interrupted', label: 'cap_interrupted' },
  { o: 'stumble', label: 'cap_stumbled' },
  { o: 'absent', label: 'cap_absent' },
];

/** The key under the dial: what a tick is, what each colour means, which repositories the bezel names. */
export function DialCaption({ arcs }: { arcs: RepoArc[] }) {
  const { t, tx } = useTranslation();
  const d = t.companions.process.dial;
  const named = arcs.filter((a) => a.span >= 14).slice(0, 3);
  const more = arcs.length - named.length;
  return (
    <div className="dial-caption dial-arrive" data-dial-chrome style={{ '--d': '1300ms' } as React.CSSProperties}>
      <p className="typo-caption">
        {d.cap_tick}{' '}
        {KEY.map((k) => (
          <span key={k.o} className="dial-key">
            <i className="dial-od" data-o={k.o} aria-hidden="true" />
            <span className="text-foreground">{d[k.label]}</span>
          </span>
        ))}
      </p>
      <p className="typo-caption">
        {tx(d.cap_repos, { names: named.map((a) => a.name).join(', ') })}
        {more > 0 ? `; ${tx(d.cap_more, { count: more })}` : ''}
      </p>
    </div>
  );
}
