import type { CSSProperties, ReactNode } from 'react';
import { cx, kitAttrs, stateClass, type KitState } from './types';

export interface KeyValueItem {
  k: ReactNode;
  /** null renders `none` honestly, muted. */
  v: ReactNode | null;
  /** A glyph or strip drawn before the value. */
  draw?: ReactNode;
  none?: ReactNode;
  state?: KitState;
}

/** KeyValueGrid: quiet `typo-label` keys, regular `typo-data` values, auto-fill columns. */
export function KeyValueGrid({ items, min, state }: { items: readonly KeyValueItem[]; min?: string; state?: KitState }) {
  const style = min ? ({ '--kv-min': min } as CSSProperties) : undefined;
  return (
    <dl className={cx('k-kv', stateClass(state))} {...kitAttrs('KeyValueGrid', state)} style={style}>
      {items.map((it, i) => {
        const ist: KitState = it.state ?? (it.v == null ? 'muted' : 'default');
        return (
          <div key={i} className={cx('k-kv__item', stateClass(ist))}>
            <dt className="typo-label">{it.k}</dt>
            <dd>
              {it.draw}
              {it.v == null
                ? <span className="typo-data k-regular k-quiet">{it.none}</span>
                : <span className="typo-data k-regular">{it.v}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
