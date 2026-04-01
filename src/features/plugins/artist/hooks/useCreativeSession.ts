import { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  artistRunCreativeSession,
  artistCancelCreativeSession,
  artistScanFolder,
  artistImportAsset,
  artistEnsureFolders,
} from '@/api/artist';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { EventName } from '@/lib/eventRegistry';

export function useCreativeSession() {
  const sessionId = useSystemStore((s) => s.creativeSessionId);
  const running = useSystemStore((s) => s.creativeSessionRunning);
  const output = useSystemStore((s) => s.creativeSessionOutput);
  const artistFolder = useSystemStore((s) => s.artistFolder);
  const setSessionId = useSystemStore((s) => s.setCreativeSessionId);
  const setRunning = useSystemStore((s) => s.setCreativeSessionRunning);
  const appendOutput = useSystemStore((s) => s.appendCreativeOutput);
  const clearOutput = useSystemStore((s) => s.clearCreativeOutput);

  const sendPrompt = useCallback(async (userPrompt: string, tools: string[]) => {
    const newId = `creative-${Date.now()}`;
    setSessionId(newId);
    setRunning(true);
    appendOutput(`[You] ${userPrompt}`);

    try {
      // Ensure the output folder exists before starting
      if (artistFolder) {
        await artistEnsureFolders(artistFolder);
      }
      await artistRunCreativeSession(newId, userPrompt, tools, artistFolder);
    } catch (err) {
      setRunning(false);
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : String(err),
        'error',
      );
    }
  }, [setSessionId, setRunning, appendOutput, artistFolder]);

  const cancel = useCallback(async () => {
    if (sessionId) {
      await artistCancelCreativeSession(sessionId);
      setRunning(false);
      appendOutput('[System] Session cancelled.');
    }
  }, [sessionId, setRunning, appendOutput]);

  const clear = useCallback(() => {
    clearOutput();
    setSessionId(null);
    setRunning(false);
  }, [clearOutput, setSessionId, setRunning]);

  // Auto-scan artist folder after session completes to pick up new assets
  const scanForNewAssets = useCallback(async () => {
    if (!artistFolder) return;
    try {
      const scanned = await artistScanFolder(artistFolder);
      let imported = 0;
      for (const asset of scanned) {
        const result = await artistImportAsset(asset);
        if (result !== null) imported++;
      }
      if (imported > 0) {
        appendOutput(`[System] Imported ${imported} new asset(s) to gallery.`);
      }
    } catch {
      // Scan failure is non-critical
    }
  }, [artistFolder, appendOutput]);

  // Listen to streaming events
  useEffect(() => {
    const unsubOutput = listen<{ job_id: string; line: string }>(
      EventName.ARTIST_SESSION_OUTPUT,
      (event) => {
        appendOutput(event.payload.line);
      },
    );

    const unsubStatus = listen<{ job_id: string; status: string; error?: string }>(
      EventName.ARTIST_SESSION_STATUS,
      (event) => {
        const { status, error } = event.payload;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          setRunning(false);
          if (error) {
            appendOutput(`[Error] ${error}`);
          }
        }
      },
    );

    const unsubComplete = listen<{ session_id: string; output_lines: number }>(
      EventName.ARTIST_SESSION_COMPLETE,
      () => {
        setRunning(false);
        // Auto-scan for new assets after session completes
        scanForNewAssets();
      },
    );

    return () => {
      unsubOutput.then((fn) => fn());
      unsubStatus.then((fn) => fn());
      unsubComplete.then((fn) => fn());
    };
  }, [appendOutput, setRunning, scanForNewAssets]);

  return { sessionId, running, output, sendPrompt, cancel, clear };
}
