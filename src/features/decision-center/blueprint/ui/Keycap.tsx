import { capOf } from '../model/keymap';

/** A drafting keycap: the key as the keymap names it (`ArrowDown` prints as an arrow). Decorative next to its label. */
export function Keycap({ k }: { k: string }) {
  return <kbd className="bp-kbd">{capOf(k)}</kbd>;
}

/** Keycaps for the keys of one binding, at most `max` of them. */
export function Keycaps({ keys, max = 2 }: { keys: readonly string[]; max?: number }) {
  return <span className="bp-kcs">{keys.slice(0, max).map((k) => <Keycap key={k} k={k} />)}</span>;
}
