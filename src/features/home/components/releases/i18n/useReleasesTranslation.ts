/**
 * Thin compatibility shim for the "What's New" feature translations.
 *
 * Previously this file owned 14 per-locale bundles with a custom lazy-loader
 * and 9 `as unknown as` casts papering over key drift. All strings now live
 * in the main i18n system under `src/i18n/en.ts` → `releases.whats_new.*`.
 * Non-English locales fall back to English via the main deep-merge loader.
 *
 * The exported `useReleasesTranslation()` and `ReleasesTranslation` type are
 * kept for one cycle to avoid touching every consuming component in one go —
 * they delegate fully to `useTranslation()` with no extra caching or casting.
 */
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Shape helpers
//
// Components consume `t` as a nested object (e.g. `t.status.released`,
// `t.releases['0.0.2'].items['3'].title`). We re-assemble that shape here
// from the flat keys stored in en.ts so component call-sites need no changes.
// ---------------------------------------------------------------------------

type ReleaseItemI18n = { title: string; description: string };
type ReleaseI18n = {
  label: string;
  summary: string;
  items: Record<string, ReleaseItemI18n>;
};

export interface ReleasesTranslation {
  title: string;
  subtitle: { roadmap: string; changelog: string };
  navBar: { roadmapLabel: string };
  status: { released: string; active: string; planned: string; roadmap: string };
  type: { feature: string; fix: string; security: string; docs: string; chore: string; breaking: string };
  itemStatus: { in_progress: string; planned: string; completed: string };
  priority: { now: string; next: string; later: string };
  summary: { inProgress: string; next: string };
  live: { updatedPrefix: string; sourceCache: string; sourceFallback: string };
  empty: string;
  releases: Record<string, ReleaseI18n>;
}

export function useReleasesTranslation(): { t: ReleasesTranslation; language: string } {
  const { t: raw, language } = useTranslation();
  const r = raw.releases.whats_new;

  const t: ReleasesTranslation = {
    title: r.title,
    subtitle: {
      roadmap: r.subtitle_roadmap,
      changelog: r.subtitle_changelog,
    },
    navBar: {
      roadmapLabel: r.nav_bar_roadmap_label,
    },
    status: {
      released: r.status_released,
      active: r.status_active,
      planned: r.status_planned,
      roadmap: r.status_roadmap,
    },
    type: {
      feature: r.type_feature,
      fix: r.type_fix,
      security: r.type_security,
      docs: r.type_docs,
      chore: r.type_chore,
      breaking: r.type_breaking,
    },
    itemStatus: {
      in_progress: r.item_status_in_progress,
      planned: r.item_status_planned,
      completed: r.item_status_completed,
    },
    priority: {
      now: r.priority_now,
      next: r.priority_next,
      later: r.priority_later,
    },
    summary: {
      inProgress: r.summary_in_progress,
      next: r.summary_next,
    },
    live: {
      updatedPrefix: r.live_updated_prefix,
      sourceCache: r.live_source_cache,
      sourceFallback: r.live_source_fallback,
    },
    empty: r.empty,
    releases: {
      '0.0.1': {
        label: r.release_0_0_1_label,
        summary: r.release_0_0_1_summary,
        items: {
          '1': { title: r.release_0_0_1_item_1_title, description: r.release_0_0_1_item_1_description },
        },
      },
      '0.0.2': {
        label: r.release_0_0_2_label,
        summary: r.release_0_0_2_summary,
        items: {
          '1':  { title: r.release_0_0_2_item_1_title,  description: r.release_0_0_2_item_1_description },
          '2':  { title: r.release_0_0_2_item_2_title,  description: r.release_0_0_2_item_2_description },
          '3':  { title: r.release_0_0_2_item_3_title,  description: r.release_0_0_2_item_3_description },
          '4':  { title: r.release_0_0_2_item_4_title,  description: r.release_0_0_2_item_4_description },
          '5':  { title: r.release_0_0_2_item_5_title,  description: r.release_0_0_2_item_5_description },
          '6':  { title: r.release_0_0_2_item_6_title,  description: r.release_0_0_2_item_6_description },
          '7':  { title: r.release_0_0_2_item_7_title,  description: r.release_0_0_2_item_7_description },
          '8':  { title: r.release_0_0_2_item_8_title,  description: r.release_0_0_2_item_8_description },
          '9':  { title: r.release_0_0_2_item_9_title,  description: r.release_0_0_2_item_9_description },
          '10': { title: r.release_0_0_2_item_10_title, description: r.release_0_0_2_item_10_description },
          '11': { title: r.release_0_0_2_item_11_title, description: r.release_0_0_2_item_11_description },
          '12': { title: r.release_0_0_2_item_12_title, description: r.release_0_0_2_item_12_description },
          '13': { title: r.release_0_0_2_item_13_title, description: r.release_0_0_2_item_13_description },
          '14': { title: r.release_0_0_2_item_14_title, description: r.release_0_0_2_item_14_description },
          '15': { title: r.release_0_0_2_item_15_title, description: r.release_0_0_2_item_15_description },
          '16': { title: r.release_0_0_2_item_16_title, description: r.release_0_0_2_item_16_description },
          '17': { title: r.release_0_0_2_item_17_title, description: r.release_0_0_2_item_17_description },
          '18': { title: r.release_0_0_2_item_18_title, description: r.release_0_0_2_item_18_description },
          '19': { title: r.release_0_0_2_item_19_title, description: r.release_0_0_2_item_19_description },
          '20': { title: r.release_0_0_2_item_20_title, description: r.release_0_0_2_item_20_description },
        },
      },
      roadmap: {
        label: r.release_roadmap_label,
        summary: r.release_roadmap_summary,
        items: {
          '2': { title: r.release_roadmap_item_2_title, description: r.release_roadmap_item_2_description },
          '3': { title: r.release_roadmap_item_3_title, description: r.release_roadmap_item_3_description },
          '4': { title: r.release_roadmap_item_4_title, description: r.release_roadmap_item_4_description },
          '6': { title: r.release_roadmap_item_6_title, description: r.release_roadmap_item_6_description },
        },
      },
    },
  };

  return { t, language };
}
