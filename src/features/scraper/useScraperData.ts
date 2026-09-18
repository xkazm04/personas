import { useCallback, useEffect, useState } from 'react';

import {
  deleteScraperConfig,
  listScraperConfigs,
  listScraperDatasets,
  queryScraperDataset,
  runScraperConfig,
  saveScraperConfig,
  type DatasetRecord,
  type DatasetSummary,
  type ExtractSummary,
  type ScraperConfig,
  type ScraperConfigInput,
} from '@/api/scraper';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { errMsg } from '@/stores/storeTypes';

/**
 * Shared data + actions for the Scraper surface. All prototype variants consume
 * this so they render identical data and mutate through one place (Phase 1b-2).
 */

// Module-scoped cache (docs/design/overview-loading.md, law 1: "data on
// screen is sacred"). configs/datasets are local useState, not store-backed,
// so every fresh mount used to start genuinely cold. Stashing the last fetch
// here lets a RETURN visit within the same session paint real rows on frame 1
// and refresh silently behind it; only a truly first-ever visit (or a fresh
// reload) sees the cold-load ghost.
let cachedConfigs: ScraperConfig[] = [];
let cachedDatasets: DatasetSummary[] = [];
/** Props every prototype variant receives — shared data + edit affordances. */
export interface ScraperVariantProps {
  data: ScraperData;
  onNew: () => void;
  onEdit: (config: ScraperConfig) => void;
}

export interface ScraperData {
  configs: ScraperConfig[];
  datasets: DatasetSummary[];
  loading: boolean;
  error: string | null;
  runningId: string | null;
  reload: () => Promise<void>;
  save: (input: ScraperConfigInput) => Promise<ScraperConfig | null>;
  run: (id: string) => Promise<ExtractSummary | null>;
  remove: (id: string) => Promise<void>;
  /** Records for a dataset, or `null` when the read FAILED — an empty array
   *  means an empty dataset, and the inspector must be able to tell the two
   *  apart rather than render a convincing "nothing here". */
  queryDataset: (name: string, changedOnly?: boolean) => Promise<DatasetRecord[] | null>;
}

export function useScraperData(): ScraperData {
  const [configs, setConfigs] = useState<ScraperConfig[]>(cachedConfigs);
  const [datasets, setDatasets] = useState<DatasetSummary[]>(cachedDatasets);
  // True while a (re)fetch is in flight — nothing more. It NEVER hides rows
  // already on screen (cached or freshly loaded); it only decides whether an
  // empty row region shows a ghost (fetch running) or the settled-empty state
  // (fetch finished, genuinely nothing). See docs/design/overview-loading.md.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgs, dsets] = await Promise.all([
        listScraperConfigs(),
        listScraperDatasets(),
      ]);
      setConfigs(cfgs);
      setDatasets(dsets);
      cachedConfigs = cfgs;
      cachedDatasets = dsets;
      setError(null);
    } catch (e) {
      // The backend returns a structured AppError envelope (`{ error, kind, … }`),
      // not an Error instance — errMsg unwraps both shapes.
      setError(errMsg(e, String(e)));
      silentCatch('scraper: load configs/datasets')(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (input: ScraperConfigInput) => {
      try {
        const saved = await saveScraperConfig(input);
        await reload();
        return saved;
      } catch (e) {
        toastCatch('scraper action')(e);
        return null;
      }
    },
    [reload],
  );

  const run = useCallback(
    async (id: string) => {
      setRunningId(id);
      try {
        const summary = await runScraperConfig(id);
        await reload();
        return summary;
      } catch (e) {
        toastCatch('scraper action')(e);
        return null;
      } finally {
        setRunningId(null);
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteScraperConfig(id);
        await reload();
      } catch (e) {
        toastCatch('scraper action')(e);
      }
    },
    [reload],
  );

  const queryDataset = useCallback(
    async (name: string, changedOnly = false) => {
      try {
        return await queryScraperDataset(name, 100, changedOnly);
      } catch (e) {
        toastCatch('scraper action')(e);
        return null;
      }
    },
    [],
  );

  return {
    configs,
    datasets,
    loading,
    error,
    runningId,
    reload,
    save,
    run,
    remove,
    queryDataset,
  };
}

// -- shared display helpers (used across variants) --------------------------

/** Human summary of a scrape's cadence from its cron (best-effort, UTC). */
export function cadenceLabel(cron: string | null): string {
  if (!cron) return 'Manual';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min = '*', hour = '*', dom = '*', mon = '*', dow = '*'] = parts;
  if (min === '*' && hour === '*') return 'Every minute';
  if (dom === '*' && mon === '*' && dow === '*' && hour === '*') return 'Hourly';
  if (dom === '*' && mon === '*' && dow === '*') return `Daily ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  if (dow !== '*' && dom === '*') return `Weekly (day ${dow})`;
  return `cron ${cron}`;
}

/** Field names a scrape extracts, from its rule set. */
export function ruleFields(rules: Record<string, unknown> | null | undefined): string[] {
  return rules ? Object.keys(rules) : [];
}

/** How a last-run status should READ, not just what it says. */
export type ScrapeStatusTone = 'ok' | 'error' | 'collapsed' | 'unknown';

/**
 * Pull "2 new, 1 changed" out of a status line. Returns null when the line does
 * not carry those counters at all (an older or differently-shaped message), so
 * an unparsed line is never mistaken for a measured zero.
 */
export function parseHarvestCounts(text: string): { added: number; changed: number } | null {
  const added = /(\d+)\s+new\b/.exec(text);
  const changed = /(\d+)\s+changed\b/.exec(text);
  if (!added && !changed) return null;
  return { added: Number(added?.[1] ?? 0), changed: Number(changed?.[1] ?? 0) };
}

/**
 * Parse "ok — 2 new, 1 changed, …" / "error — …" into a compact status.
 *
 * COLLAPSE (web-scraping / dedup-and-datasets): the scraper's default failure
 * mode is "success, zero records" — a page redesign moves every selector, the
 * fetch still returns 200, and the run reports `ok — 0 new`. Against a dataset
 * that already holds records that is not a quiet day, it is the extraction
 * having stopped working, and it must not wear a green dot.
 *
 * @param datasetCount records the scrape's dataset already holds. Pass it to
 *   enable collapse detection; omit it and a zero harvest stays plain `ok`,
 *   because with no prior count there is nothing to have collapsed FROM. A
 *   first run that honestly finds nothing is not a failure.
 */
export function parseStatus(
  status: string | null,
  datasetCount?: number,
): {
  ok: boolean | null;
  tone: ScrapeStatusTone;
  /** True when a run reported success while harvesting nothing into a non-empty dataset. */
  collapsed: boolean;
  text: string;
} {
  if (!status) return { ok: null, tone: 'unknown', collapsed: false, text: 'Never run' };
  if (status.startsWith('error')) {
    return { ok: false, tone: 'error', collapsed: false, text: status.replace(/^error\s*—\s*/, '') };
  }
  if (status.startsWith('ok')) {
    const text = status.replace(/^ok\s*—\s*/, '');
    const counts = parseHarvestCounts(text);
    const collapsed =
      counts !== null
      && counts.added === 0
      && counts.changed === 0
      && (datasetCount ?? 0) > 0;
    return { ok: true, tone: collapsed ? 'collapsed' : 'ok', collapsed, text };
  }
  return { ok: null, tone: 'unknown', collapsed: false, text: status };
}
