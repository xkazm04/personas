import { useState, useCallback, useEffect } from 'react';
import {
  artistListAssets,
  artistScanFolder,
  artistImportAsset,
  artistDeleteAsset,
  artistRenameAsset,
  artistUpdateTags,
  artistGetDefaultFolder,
  artistEnsureFolders,
  type ArtistAsset,
} from '@/api/artist';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { invalidateLocalImage } from './useLocalImage';

export function useArtistAssets() {
  const { t, tx } = useTranslation();
  const [assets, setAssets] = useState<ArtistAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artistFolder = useSystemStore((s) => s.artistFolder);
  const setArtistFolder = useSystemStore((s) => s.setArtistFolder);

  const loadAssets = useCallback(async (assetType?: string) => {
    setLoading(true);
    setError(null);
    try {
      setAssets(await artistListAssets(assetType));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toastCatch('useArtistAssets:loadAssets')(err);
    } finally {
      setLoading(false);
    }
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
      .then(() =>
        setAssets((prev) => {
          // Evict the deleted asset's cached thumbnail so a later asset reusing
          // its path can't be served the old image from the module cache.
          const gone = prev.find((a) => a.id === id);
          if (gone) invalidateLocalImage(gone.filePath);
          return prev.filter((a) => a.id !== id);
        }),
      )
      .catch(toastCatch('useArtistAssets:deleteAsset'));
  }, []);

  const updateTags = useCallback(async (id: string, tags: string) => {
    await artistUpdateTags(id, tags)
      .then((updated) => setAssets((prev) => prev.map((a) => (a.id === id ? updated : a))))
      .catch(toastCatch('useArtistAssets:updateTags'));
  }, []);

  const renameAsset = useCallback(async (id: string, newBasename: string) => {
    await artistRenameAsset(id, newBasename)
      .then((updated) =>
        setAssets((prev) => {
          // Rename changes the file path; evict the OLD path's cached thumbnail
          // so it doesn't linger as stale data for a future path reuse.
          const old = prev.find((a) => a.id === id);
          if (old && old.filePath !== updated.filePath) invalidateLocalImage(old.filePath);
          return prev.map((a) => (a.id === id ? updated : a));
        }),
      )
      .catch(toastCatch('useArtistAssets:renameAsset'));
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
    error,
    scanning,
    loadAssets,
    scanAndImport,
    deleteAsset,
    updateTags,
    renameAsset,
  };
}
