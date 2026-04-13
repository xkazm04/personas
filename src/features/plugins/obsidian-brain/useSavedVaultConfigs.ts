import { useCallback, useEffect, useState } from 'react';
import type { ObsidianVaultConfig } from '@/api/obsidianBrain';

const STORAGE_KEY = 'obsidian-brain.saved-vault-configs.v1';

function readStorage(): ObsidianVaultConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ObsidianVaultConfig[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(configs: ObsidianVaultConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch {
    /* ignore quota errors */
  }
  window.dispatchEvent(new CustomEvent('obsidian-brain:saved-configs-changed'));
}

export function useSavedVaultConfigs() {
  const [configs, setConfigs] = useState<ObsidianVaultConfig[]>(() => readStorage());

  useEffect(() => {
    const handler = () => setConfigs(readStorage());
    window.addEventListener('obsidian-brain:saved-configs-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('obsidian-brain:saved-configs-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const addOrUpdate = useCallback((config: ObsidianVaultConfig) => {
    const next = readStorage();
    const idx = next.findIndex((c) => c.vaultPath === config.vaultPath);
    if (idx >= 0) next[idx] = config;
    else next.push(config);
    writeStorage(next);
  }, []);

  const remove = useCallback((vaultPath: string) => {
    const next = readStorage().filter((c) => c.vaultPath !== vaultPath);
    writeStorage(next);
  }, []);

  return { configs, addOrUpdate, remove };
}
