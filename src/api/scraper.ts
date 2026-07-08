import { invokeWithTimeout } from '@/lib/tauriInvoke';

/**
 * Frontend API for the embedded local scraper (Pumper, Phase 1b-2).
 *
 * The backend commands return untyped JSON (the engine types are behind a cargo
 * feature), so the display shapes are declared here. Mirrors
 * `src-tauri/src/commands/infrastructure/scraper.rs` +
 * `src-tauri/src/engine/scraper.rs`.
 */

/** One extraction rule for a field (matches pumper-core `extract::Rule`). */
export type ScrapeRule =
  | { type: 'css'; selector: string; attr?: string | null; all?: boolean }
  | { type: 'regex'; pattern: string; group?: number }
  | { type: 'json'; pointer: string }
  | { type: 'const'; value: unknown };

/** field name → rule */
export type ScrapeRuleSet = Record<string, ScrapeRule>;

/** A persisted, optionally cron-scheduled declarative scrape. */
export interface ScraperConfig {
  id: string;
  name: string;
  urls: string[];
  rules: ScrapeRuleSet;
  dataset: string;
  keyField: string | null;
  cron: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields sent when creating/updating a config (snake_case for the Rust side). */
export interface ScraperConfigInput {
  id?: string;
  name: string;
  urls: string[];
  rules: ScrapeRuleSet;
  dataset: string;
  key_field?: string | null;
  cron?: string | null;
  enabled?: boolean;
}

/** Summary returned by a run (new/changed/unchanged + the extracted records). */
export interface ExtractSummary {
  dataset: string;
  scanned: number;
  new: number;
  changed: number;
  unchanged: number;
  errors: string[];
  records: Array<Record<string, unknown>>;
}

/** Per-dataset rollup for the datasets view. */
export interface DatasetSummary {
  name: string;
  count: number;
  lastUpdated: string | null;
}

/** One change-detected record read back from a dataset. */
export interface DatasetRecord {
  key: string;
  data: Record<string, unknown> | string;
  firstSeen: string;
  lastSeen: string;
  updatedAt: string;
}

export const listScraperConfigs = () =>
  invokeWithTimeout<ScraperConfig[]>('scraper_list_configs');

export const saveScraperConfig = (config: ScraperConfigInput) =>
  invokeWithTimeout<ScraperConfig>('scraper_save_config', { config });

export const runScraperConfig = (id: string) =>
  invokeWithTimeout<ExtractSummary>('scraper_run_config', { id });

export const deleteScraperConfig = (id: string) =>
  invokeWithTimeout<void>('scraper_delete_config', { id });

export const runScraperExtract = (config: ScraperConfigInput) =>
  invokeWithTimeout<ExtractSummary>('scraper_run_extract', { config });

export const listScraperDatasets = () =>
  invokeWithTimeout<DatasetSummary[]>('scraper_list_datasets');

export const queryScraperDataset = (
  dataset: string,
  limit = 100,
  changedOnly = false,
) =>
  invokeWithTimeout<DatasetRecord[]>('scraper_query_dataset', {
    dataset,
    limit,
    changedOnly,
  });
