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

/**
 * Shared data + actions for the Scraper surface. All prototype variants consume
 * this so they render identical data and mutate through one place (Phase 1b-2).
 */
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
  queryDataset: (name: string, changedOnly?: boolean) => Promise<DatasetRecord[]>;
}

export function useScraperData(): ScraperData {
  const [configs, setConfigs] = useState<ScraperConfig[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [cfgs, dsets] = await Promise.all([
        listScraperConfigs(),
        listScraperDatasets(),
      ]);
      setConfigs(cfgs);
      setDatasets(dsets);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        return [];
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

/** Parse "ok — 2 new, 1 changed, …" / "error — …" into a compact status. */
export function parseStatus(status: string | null): {
  ok: boolean | null;
  text: string;
} {
  if (!status) return { ok: null, text: 'Never run' };
  if (status.startsWith('ok')) return { ok: true, text: status.replace(/^ok\s*—\s*/, '') };
  if (status.startsWith('error')) return { ok: false, text: status.replace(/^error\s*—\s*/, '') };
  return { ok: null, text: status };
}
