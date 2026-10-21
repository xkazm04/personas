import { useCallback, useEffect, useState } from 'react';
import {
  obsidianBrainListSavedVaults,
  obsidianBrainSetSavedVaults,
  type ObsidianVaultConfig,
} from '@/api/obsidianBrain';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

// Pre-2026-06 storage. The roster lived in webview localStorage, which does
// not reliably survive app sessions (webview profile resets dropped it). It
// now persists in the app database via obsidian_brain_list/set_saved_vaults;
// this key remains only as a one-time migration source.
const LEGACY_STORAGE_KEY = 'obsidian-brain.saved-vault-configs.v1';
const CHANGED_EVENT = 'obsidian-brain:saved-configs-changed';

// Module-level cache: every hook instance shares one backend load, and
// add/remove updates render synchronously across panels via CHANGED_EVENT.
let cache: ObsidianVaultConfig[] | null = null;
let inflight: Promise<ObsidianVaultConfig[]> | null = null;

function readLegacyStorage(): ObsidianVaultConfig[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ObsidianVaultConfig[]) : [];
  } catch {
    return [];
  }
}

async function loadConfigs(): Promise<ObsidianVaultConfig[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    let configs: ObsidianVaultConfig[] = [];
    try {
      configs = await obsidianBrainListSavedVaults();
    } catch (err) {
      silentCatch('features/plugins/obsidian-brain/useSavedVaultConfigs:load')(err);
    }
    // One-time migration of the legacy localStorage roster into the DB.
    const legacy = readLegacyStorage();
    if (legacy.length > 0) {
      const known = new Set(configs.map((c) => c.vaultPath));
      const merged = [...configs, ...legacy.filter((c) => !known.has(c.vaultPath))];
      try {
        await obsidianBrainSetSavedVaults(merged);
        configs = merged;
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (err) {
        // Keep the legacy key so the next launch retries the migration.
        silentCatch('features/plugins/obsidian-brain/useSavedVaultConfigs:migrate')(err);
      }
    }
    cache = configs;
    inflight = null;
    return configs;
  })();
  return inflight;
}

/**
 * Optimistic write: the UI updates first, then the roster is written to the DB.
 * A rejected write rolls the cache back (unless a later edit already replaced
 * it) and toasts, so the roster never shows a state the next launch will undo.
 * Resolves true when the write landed.
 */
async function persist(next: ObsidianVaultConfig[]): Promise<boolean> {
  const prev = cache ?? [];
  cache = next;
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  try {
    await obsidianBrainSetSavedVaults(next);
    return true;
  } catch (err) {
    toastCatch('features/plugins/obsidian-brain/useSavedVaultConfigs:persist')(err);
    if (cache === next) {
      cache = prev;
      window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
    }
    return false;
  }
}

export function useSavedVaultConfigs() {
  const [configs, setConfigs] = useState<ObsidianVaultConfig[]>(() => cache ?? []);

  useEffect(() => {
    let alive = true;
    void loadConfigs().then((c) => {
      if (alive) setConfigs(c);
    });
    const handler = () => setConfigs(cache ?? []);
    window.addEventListener(CHANGED_EVENT, handler);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED_EVENT, handler);
    };
  }, []);

  const addOrUpdate = useCallback((config: ObsidianVaultConfig) => {
    const next = [...(cache ?? [])];
    const idx = next.findIndex((c) => c.vaultPath === config.vaultPath);
    if (idx >= 0) next[idx] = config;
    else next.push(config);
    return persist(next);
  }, []);

  const remove = useCallback((vaultPath: string) => {
    return persist((cache ?? []).filter((c) => c.vaultPath !== vaultPath));
  }, []);

  return { configs, addOrUpdate, remove };
}
