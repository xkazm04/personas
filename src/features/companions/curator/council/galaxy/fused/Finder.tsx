// Find: every name in the registry, one field, and a flight to the one you
// pick. A name that starts with what you typed ranks first, then one where a
// word does, then any other match; domains before categories before subjects
// before techniques at equal rank.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout, GalaxyNode } from '../engine/types';
import { nodeTitle } from './fusedModel';
import { useFusedStore } from './fusedStore';
import { useFusedStrings } from './fusedStrings';

const KIND_RANK: Record<GalaxyNode['kind'], number> = { domain: 0, category: 1, subject: 2, technique: 3 };
const LIMIT = 9;

function trail(n: GalaxyNode): string {
  if (n.kind === 'technique') return `${n.subject.domain.title} / ${n.subject.category.title} / ${n.subject.title}`;
  if (n.kind === 'subject') return `${n.domain.title} / ${n.category.title}`;
  if (n.kind === 'category') return n.domain.title;
  return '';
}

export function Finder({ engine, layout }: { engine: GalaxyEngine | null; layout: GalaxyLayout }) {
  const s = useFusedStrings();
  const setOpen = useFusedStore((st) => st.setFinderOpen);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const index = useMemo(() => {
    const all: GalaxyNode[] = [];
    for (const d of layout.domains) {
      all.push(d);
      for (const c of d.categories) {
        all.push(c);
        for (const sub of c.subjects) all.push(sub, ...sub.techniques);
      }
    }
    return all.map((node) => ({ node, t: nodeTitle(node).toLowerCase() }));
  }, [layout]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return index
      .map((it) => {
        const i = it.t.indexOf(needle);
        if (i < 0) return null;
        const score = (i === 0 ? 0 : it.t[i - 1] === ' ' ? 1 : 2) * 10 + KIND_RANK[it.node.kind] * 2 + it.t.length / 100;
        return { node: it.node, score };
      })
      .filter((x): x is { node: GalaxyNode; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, LIMIT)
      .map((x) => x.node);
  }, [index, q]);

  useEffect(() => inputRef.current?.focus(), []);

  const go = (n: GalaxyNode | undefined) => {
    if (!n) return;
    setOpen(false);
    engine?.goTo(n);
  };

  return (
    <div className="fz-finder" role="search" aria-label={s.f.finder_label}>
      <input
        ref={inputRef}
        value={q}
        placeholder={s.f.finder_placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((v) => Math.min(results.length - 1, v + 1));
          else if (e.key === 'ArrowUp') setSel((v) => Math.max(0, v - 1));
          else if (e.key === 'Enter') go(results[sel]);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <ul>
        {!q.trim() ? <li className="empty">{s.f.finder_hint}</li> : null}
        {q.trim() && results.length === 0 ? <li className="empty">{s.f.finder_none}</li> : null}
        {results.map((n, i) => (
          <li key={`${n.kind}:${trail(n)}:${n.rank}`} className={i === sel ? 'sel' : ''}>
            <button type="button" tabIndex={-1} onClick={() => go(n)} onMouseEnter={() => setSel(i)}>
              <span className="fk">{s.tag(n.kind)}</span>
              <span className="fn">{nodeTitle(n)}</span>
              <span className="fp">{trail(n) || s.f.tag_sky}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Finder;
