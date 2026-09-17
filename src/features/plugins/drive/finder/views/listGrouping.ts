import type { DriveEntry } from "@/api/drive";
import { bucketOf, type KindBucket } from "./kindVisual";

/** Row height for every entry row; group headers are shorter. */
export const ROW_H = 36;
export const GROUP_H = 28;
/** Height of the sticky column header the list renders above the rows. */
export const HEADER_H = 36;

export type ListItem =
  | { type: "header"; bucket: KindBucket; count: number; key: string }
  | { type: "entry"; entry: DriveEntry; index: number; key: string };

/**
 * Flatten entries into the virtualizer's item list. When `grouped` (sort by
 * kind), a header item precedes every run of a new bucket and carries the
 * bucket's total count. Entries are assumed already sorted by the engine, so
 * a bucket is one contiguous run.
 */
export function buildListItems(entries: DriveEntry[], grouped: boolean): ListItem[] {
  if (!grouped) {
    return entries.map((entry, index) => ({ type: "entry", entry, index, key: entry.path }));
  }
  const buckets = entries.map((e) => bucketOf(e));
  // Counted at header time from the bucket list itself: a header is only ever
  // emitted for a bucket that has at least one entry, so there is no "absent"
  // case to default.
  const countOf = (b: KindBucket) => buckets.reduce((n, x) => n + (x === b ? 1 : 0), 0);
  const items: ListItem[] = [];
  let prev: KindBucket | null = null;
  entries.forEach((entry, index) => {
    const bucket = buckets[index] as KindBucket;
    if (bucket !== prev) {
      items.push({ type: "header", bucket, count: countOf(bucket), key: `#${bucket}` });
      prev = bucket;
    }
    items.push({ type: "entry", entry, index, key: entry.path });
  });
  return items;
}

export function itemSize(item: ListItem | undefined): number {
  return item?.type === "header" ? GROUP_H : ROW_H;
}

/** Indexes of every header item — the sticky candidates. */
export function headerIndexes(items: ListItem[]): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.type === "header") out.push(i);
  });
  return out;
}

/** The header that governs the first visible row: the last header at or before it. */
export function activeHeaderIndex(headers: number[], firstVisible: number): number | null {
  let active: number | null = null;
  for (const h of headers) {
    if (h <= firstVisible) active = h;
    else break;
  }
  return active;
}
