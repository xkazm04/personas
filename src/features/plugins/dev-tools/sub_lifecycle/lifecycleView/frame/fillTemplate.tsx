// A translated template with React nodes in its slots: "Measured {time} on
// {sha}" where {time} is a live <RelativeTime> and {sha} a code span. `tx`
// returns a string, so a node cannot go through it; this splits the template
// on its `{name}` slots and puts each node in place, keeping the translator's
// word order. A slot with no node is left as written, so a missing value shows.
import { Fragment, type ReactNode } from 'react';

export function fillTemplate(template: string, slots: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    const node = m && Object.prototype.hasOwnProperty.call(slots, m[1]!) ? slots[m[1]!] : part;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
