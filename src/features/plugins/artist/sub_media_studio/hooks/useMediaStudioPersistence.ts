import { useCallback, useEffect, useRef, useState } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  artistAutosaveComposition,
  artistClearAutosave,
  artistCompositionFileExtension,
  artistDefaultSaveDir,
  artistLoadAutosave,
  artistLoadComposition,
  artistSaveComposition,
} from '@/api/artist';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { Composition } from '../types';

/** How long after the last edit to flush an autosave. */
const AUTOSAVE_DEBOUNCE_MS = 800;

export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface MediaStudioPersistence {
  /** Was the current state restored from an autosave? (for one-shot UX hints) */
  restoredFromAutosave: boolean;
  /** Last save outcome — 'saved' flips to 'idle' after a short cooldown. */
  status: PersistenceStatus;
  /** Path of the current user file if any (drives Save vs Save As semantics). */
  currentFile: string | null;
  /** Timestamp of the most recent successful save (user or autosave). */
  lastSavedAt: number | null;

  /** Save to the currentFile, or prompt for a path if none. */
  save: () => Promise<void>;
  /** Prompt for a path and save. */
  saveAs: () => Promise<void>;
  /** Prompt for a file and load it into the composition store. */
  openFile: () => Promise<void>;
  /** Acknowledge the "restored from autosave" banner. */
  dismissRestoreHint: () => void;
}

interface Opts {
  /** Current composition. Autosave listens for changes. */
  composition: Composition;
  /** Replace the composition store's state — used after Open and autosave restore. */
  replaceComposition: (next: Composition) => void;
  /** Is the app ready to autosave? false during first render before restore. */
  enabled: boolean;
}

/**
 * Composition persistence: autosave to app data dir + Save/Open to user
 * files under Documents/Personas Media Studio/. Works alongside
 * `useMediaStudio` — it doesn't own the composition state, it just drives
 * the side effects of persisting it.
 */
export function useMediaStudioPersistence({
  composition,
  replaceComposition,
  enabled,
}: Opts): MediaStudioPersistence {
  const [restoredFromAutosave, setRestoredFromAutosave] = useState(false);
  const [status, setStatus] = useState<PersistenceStatus>('idle');
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const autosaveInFlight = useRef(false);
  const hydratedRef = useRef(false);

  // -- Autosave: debounced write on every composition change ---------------
  useEffect(() => {
    if (!enabled || !hydratedRef.current) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      // Prevent overlapping writes if the backend is slow — the next edit
      // will re-queue and catch the latest state.
      if (autosaveInFlight.current) return;
      autosaveInFlight.current = true;
      setStatus('saving');
      artistAutosaveComposition(JSON.stringify(composition))
        .then(() => {
          setStatus('saved');
          setLastSavedAt(Date.now());
        })
        .catch(
          (err: unknown) => {
            setStatus('error');
            silentCatch('autosave')(err);
          },
        )
        .finally(() => {
          autosaveInFlight.current = false;
        });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [composition, enabled]);

  // Tick status back to idle a few seconds after a save so the UI doesn't
  // flash "saved" permanently.
  useEffect(() => {
    if (status !== 'saved') return;
    const h = window.setTimeout(() => setStatus('idle'), 2500);
    return () => window.clearTimeout(h);
  }, [status]);

  // -- Restore autosave on mount -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restore = await artistLoadAutosave();
        if (cancelled || !restore) {
          hydratedRef.current = true;
          return;
        }
        const parsed = JSON.parse(restore.compositionJson) as Composition;
        replaceComposition(parsed);
        setRestoredFromAutosave(true);
        setLastSavedAt(Date.parse(restore.savedAt) || Date.now());
      } catch (err) {
        silentCatch('load_autosave')(err);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // replaceComposition identity is stable — effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Dialog helpers ------------------------------------------------------

  const promptSavePath = useCallback(async (): Promise<string | null> => {
    const [defaultDir, ext] = await Promise.all([
      artistDefaultSaveDir().catch(() => null),
      artistCompositionFileExtension().catch(() => 'mstudio.json'),
    ]);
    const suggestedName = `${composition.name || 'Untitled'}.${ext}`;
    const defaultPath = defaultDir
      ? `${defaultDir.replace(/[\\/]+$/, '')}/${suggestedName}`
      : suggestedName;
    const picked = await saveDialog({
      title: 'Save Media Studio composition',
      defaultPath,
      filters: [{ name: 'Media Studio', extensions: [ext] }],
    });
    return typeof picked === 'string' ? picked : null;
  }, [composition.name]);

  const promptOpenPath = useCallback(async (): Promise<string | null> => {
    const [defaultDir, ext] = await Promise.all([
      artistDefaultSaveDir().catch(() => null),
      artistCompositionFileExtension().catch(() => 'mstudio.json'),
    ]);
    const picked = await openDialog({
      title: 'Open Media Studio composition',
      multiple: false,
      defaultPath: defaultDir ?? undefined,
      filters: [{ name: 'Media Studio', extensions: [ext] }],
    });
    if (!picked) return null;
    return typeof picked === 'string' ? picked : null;
  }, []);

  // -- Save / Save As / Open ----------------------------------------------

  const writeTo = useCallback(
    async (targetPath: string) => {
      setStatus('saving');
      try {
        await artistSaveComposition(JSON.stringify(composition), targetPath);
        // Explicit save clears autosave — next session should restore THIS
        // save, not an older autosave snapshot.
        await artistClearAutosave().catch(silentCatch('clear_autosave'));
        setCurrentFile(targetPath);
        setLastSavedAt(Date.now());
        setStatus('saved');
      } catch (err) {
        setStatus('error');
        toastCatch('Could not save composition')(err);
      }
    },
    [composition],
  );

  const save = useCallback(async () => {
    if (currentFile) {
      await writeTo(currentFile);
      return;
    }
    const path = await promptSavePath();
    if (path) await writeTo(path);
  }, [currentFile, promptSavePath, writeTo]);

  const saveAs = useCallback(async () => {
    const path = await promptSavePath();
    if (path) await writeTo(path);
  }, [promptSavePath, writeTo]);

  const openFile = useCallback(async () => {
    const path = await promptOpenPath();
    if (!path) return;
    try {
      const loaded = await artistLoadComposition(path);
      const parsed = JSON.parse(loaded.compositionJson) as Composition;
      replaceComposition(parsed);
      setCurrentFile(path);
      setLastSavedAt(Date.now());
      setStatus('saved');
      setRestoredFromAutosave(false);
      await artistClearAutosave().catch(silentCatch('clear_autosave'));
    } catch (err) {
      setStatus('error');
      toastCatch('Could not open composition')(err);
    }
  }, [promptOpenPath, replaceComposition]);

  const dismissRestoreHint = useCallback(() => setRestoredFromAutosave(false), []);

  return {
    restoredFromAutosave,
    status,
    currentFile,
    lastSavedAt,
    save,
    saveAs,
    openFile,
    dismissRestoreHint,
  };
}
