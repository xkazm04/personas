import type { ArtistAsset } from '@/api/artist';

export type AssetGroupKey =
  | 'group_today'
  | 'group_yesterday'
  | 'group_this_week'
  | 'group_this_month'
  | 'group_older';

export interface AssetGroup {
  labelKey: AssetGroupKey;
  assets: ArtistAsset[];
}

const DAY_MS = 86_400_000;

/**
 * Bucket gallery assets by created-at relative to `now`. Buckets are emitted
 * in chronological-newest-first order and empty buckets are dropped so the
 * caller can render section headers 1:1. Returns a flat fallback (a single
 * "older" group) for any asset whose timestamp does not parse.
 */
export function groupAssetsByDay(assets: ArtistAsset[], now: Date = new Date()): AssetGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - DAY_MS;
  // "This week" anchors at the most recent Sunday so the bucket matches what a
  // typical date picker shows; tweak if a Monday-start locale ever needs it.
  const startOfThisWeek = startOfToday - now.getDay() * DAY_MS;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const buckets: Record<AssetGroupKey, ArtistAsset[]> = {
    group_today: [],
    group_yesterday: [],
    group_this_week: [],
    group_this_month: [],
    group_older: [],
  };

  for (const asset of assets) {
    const ts = Date.parse(asset.createdAt);
    if (Number.isNaN(ts)) {
      buckets.group_older.push(asset);
      continue;
    }
    if (ts >= startOfToday) buckets.group_today.push(asset);
    else if (ts >= startOfYesterday) buckets.group_yesterday.push(asset);
    else if (ts >= startOfThisWeek) buckets.group_this_week.push(asset);
    else if (ts >= startOfThisMonth) buckets.group_this_month.push(asset);
    else buckets.group_older.push(asset);
  }

  const order: AssetGroupKey[] = [
    'group_today',
    'group_yesterday',
    'group_this_week',
    'group_this_month',
    'group_older',
  ];
  return order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ labelKey: k, assets: buckets[k] }));
}
