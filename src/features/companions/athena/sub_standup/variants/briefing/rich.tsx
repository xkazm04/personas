import { Fragment, type ReactNode } from 'react';

/**
 * Fill a `{slot}` template, setting each filled value at the strong weight, so
 * the figures in Athena's prose carry the eye without a chip or a colour.
 */
export function rich(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const value = vars[m[1]!];
    return <span key={i} className="k-strong text-foreground">{value}</span>;
  });
}

/** "a, b and c" from parts (joined in plain English; the parts are already localised). */
export function joinList(parts: readonly ReactNode[], and = ' and '): ReactNode {
  return parts.map((p, i) => (
    <Fragment key={i}>
      {i > 0 && (i === parts.length - 1 ? and : ', ')}
      {p}
    </Fragment>
  ));
}

/** "{n} things" or "1 thing". */
export function plural(n: number, many: string, one: string): string {
  return n === 1 ? one : many.replace('{n}', String(n));
}
