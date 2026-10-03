import type { ReactNode } from 'react';
import { emptyBand, GhostRows, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type KitStates } from './types';

export interface SectionProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Regular-weight figure after the title. */
  count?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  desc?: ReactNode;
  /** 1: `typo-section-title` with a 13px node; 2: `typo-title` with a 9px node. */
  level?: 1 | 2;
  state?: KitStates;
  /** Rendered in place of the body when the state is `empty`. */
  empty?: EmptySpec;
  ghostRows?: number;
  id?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Section: bounded by a node on the spine, not by a card. Owns the head recipe (eyebrow, title,
 * count, meta, actions) and its spacing; the caller owns the body and the order of sections.
 * @catalog Section - a titled part of a surface, bounded by a node on the spine (eyebrow, title, count, meta, actions; empty/loading states). Kit.
 */
export function Section({ title, eyebrow, count, meta, actions, desc, level = 1, state, empty, ghostRows = 3, id, className, children }: SectionProps) {
  const states = typeof state === 'string' ? [state] : state ?? [];
  const Heading = level === 1 ? 'h2' : 'h3';
  const body = states.includes('loading')
    ? <GhostRows count={ghostRows} />
    : states.includes('empty')
      ? emptyBand(empty ?? { title: '' })
      : children;
  return (
    <section id={id} className={cx('k-section', `k-section--l${level}`, stateClass(state), className)} {...kitAttrs('Section', state)}>
      <header className="k-section__head">
        <div className="k-section__titles">
          {eyebrow && <div className="typo-eyebrow k-quiet">{eyebrow}</div>}
          <Heading className={cx('k-section__title', level === 1 ? 'typo-section-title' : 'typo-title')}>
            <span className="k-node" aria-hidden="true" />
            {title}
            {count != null && <span className="k-count typo-data k-regular">{count}</span>}
          </Heading>
        </div>
        {meta && <div className="k-section__meta typo-caption">{meta}</div>}
        {actions && <div className="k-section__actions">{actions}</div>}
      </header>
      {desc && <p className="k-section__desc typo-caption">{desc}</p>}
      <div className="k-section__body">{body}</div>
    </section>
  );
}

/**
 * Meta parts joined by a quiet middle dot, empty parts dropped. A part stays in `display: contents`
 * so the HOST lays the parts out: in a flex meta line (`.k-row__meta`, `.k-card__meta`,
 * `.k-section__meta`, `.k-dtile__meta`) each part and each dot is a flex item and the host's own
 * gap spaces them.
 *
 * The dot carries a space on EACH SIDE as its own text node (home-3). `.k-sep` has no margin, so
 * in a host that is not a flex line - a `Section`'s `desc`, a `KeyValueGrid` value, any sentence -
 * two adjacent string parts rendered glued to it ("...10 files·Capped at 30 days"), and a builder
 * hand-rolled a separated string rather than reach for `Meta`. A space text node fixes it in
 * exactly the hosts that were broken and in no other: an anonymous flex item of only white space
 * is NOT rendered (CSS Flexbox 1 sec. 4), so every current flex caller is byte-identical, while in
 * inline flow the space renders and the sentence reads.
 * @catalog Meta - meta parts joined by a quiet middle dot that reads in a flex meta line and in a sentence alike. Kit.
 */
export function Meta({ parts }: { parts: ReadonlyArray<ReactNode> }) {
  const shown = parts.filter((p) => p != null && p !== '' && p !== false);
  return (
    <>
      {shown.map((p, i) => (
        <span key={i} className="k-meta__part">
          {i > 0 && <>{' '}<span className="k-sep" aria-hidden="true">·</span>{' '}</>}
          {p}
        </span>
      ))}
    </>
  );
}
