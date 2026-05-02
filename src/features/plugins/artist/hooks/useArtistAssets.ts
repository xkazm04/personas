import { useState, useCallback, useEffect } from 'react';
import {
  artistListAssets,
  artistScanFolder,
  artistImportAsset,
  artistDeleteAsset,
  artistUpdateTags,
  artistGetDefaultFolder,
  artistEnsureFolders,
  type ArtistAsset,
} from '@/api/artist';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export function useArtistAssets() {
  const { t, tx } = useTranslation();
  const [assets, setAssets] = useState<ArtistAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const artistFolder = useSystemStore((s) => s.artistFolder);
  const setArtistFolder = useSystemStore((s) => s.setArtistFolder);

  const loadAssets = useCallback(async (assetType?: string) => {
    setLoading(true);
    await artistListAssets(assetType)
      .then(setAssets)
      .catch(toastCatch('useArtistAssets:loadAssets'));
    setLoading(false);
  }, []);

  const scanAndImport = useCallback(async (folder: string) => {
    setScanning(true);
    try {
      await artistEnsureFolders(folder);
      const scanned = await artistScanFolder(folder);
      let imported = 0;
      for (const asset of scanned) {
        const result = await artistImportAsset(asset);
        if (result !== null) imported++;
      }
      const template = imported === 1
        ? t.plugins.artist.scan_result_one
        : t.plugins.artist.scan_result_other;
      useToastStore.getState().addToast(
        tx(template, { scanned: scanned.length, imported }),
        'success',
      );
      await loadAssets();
    } catch (err) {
      toastCatch('useArtistAssets:scanAndImport')(err);
    } finally {
      setScanning(false);
    }
  }, [loadAssets, t, tx]);

  const deleteAsset = useCallback(async (id: string) => {
    await artistDeleteAsset(id)
      .then(() => setAssets((prev) => prev.filter((a) => a.id !== id)))
      .catch(toastCatch('useArtistAssets:deleteAsset'));
  }, []);

  const updateTags = useCallback(async (id: string, tags: string) => {
    await artistUpdateTags(id, tags)
      .then((updated) => setAssets((prev) => prev.map((a) => (a.id === id ? updated : a))))
      .catch(toastCatch('useArtistAssets:updateTags'));
  }, []);

  // Initialize default folder
  useEffect(() => {
    if (!artistFolder) {
      artistGetDefaultFolder()
        .then(setArtistFolder)
        .catch(silentCatch('useArtistAssets:getDefaultFolder'));
    }
  }, [artistFolder, setArtistFolder]);

  // Load assets on mount
  useEffect(() => { loadAssets(); }, [loadAssets]);

  return {
    assets,
    loading,
    scanning,
    loadAssets,
    scanAndImport,
    deleteAsset,
    updateTags,
  };
}
