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
import { useTranslation } from '@/i18n/useTranslation';

export function useCreativeSession() {
  const { t, tx } = useTranslation();
  const sessionId = useSystemStore((s) => s.creativeSessionId);
  const running = useSystemStore((s) => s.creativeSessionRunning);
  const output = useSystemStore((s) => s.creativeSessionOutput);
  const artistFolder = useSystemStore((s) => s.artistFolder);
  const setSessionId = useSystemStore((s) => s.setCreativeSessionId);
  const setRunning = useSystemStore((s) => s.setCreativeSessionRunning);
  const appendOutput = useSystemStore((s) => s.appendCreativeOutput);
  const clearOutput = useSystemStore((s) => s.clearCreativeOutput);
  const startCreativeSessionRecord = useSystemStore((s) => s.startCreativeSessionRecord);
  const appendCreativeSessionLine = useSystemStore((s) => s.appendCreativeSessionLine);
  const finalizeCreativeSession = useSystemStore((s) => s.finalizeCreativeSession);

  const sendPrompt = useCallback(async (userPrompt: string, tools: string[]) => {
    const newId = `creative-${Date.now()}`;
    setSessionId(newId);
    setRunning(true);
    // Seed session history with the first line before any streaming output
    startCreativeSessionRecord({
      id: newId,
      startedAt: Date.now(),
      prompt: userPrompt,
      tools,
      output: [`[You] ${userPrompt}`],
      status: 'running',
    });
    appendOutput(`[You] ${userPrompt}`);

    try {
      // Ensure the output folder exists before starting
      if (artistFolder) {
        await artistEnsureFolders(artistFolder);
      }
      await artistRunCreativeSession(newId, userPrompt, tools, artistFolder);
    } catch (err) {
      setRunning(false);
      finalizeCreativeSession(newId, 'failed');
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : String(err),
        'error',
      );
    }
  }, [setSessionId, setRunning, appendOutput, artistFolder, startCreativeSessionRecord, finalizeCreativeSession]);

  const cancel = useCallback(async () => {
    if (sessionId) {
      await artistCancelCreativeSession(sessionId);
      setRunning(false);
      // Keep the machine tag ("[System]") for the renderer to style the row
      // while still translating the human-readable part. Translation teams
      // shouldn't ship a non-English [System] prefix because the OutputLine
      // renderer pattern-matches on that literal.
      const line = `[System] ${t.plugins.artist.session_cancelled}`;
      appendOutput(line);
      appendCreativeSessionLine(sessionId, line);
      finalizeCreativeSession(sessionId, 'cancelled');
    }
  }, [sessionId, setRunning, appendOutput, t, appendCreativeSessionLine, finalizeCreativeSession]);

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
        const msg = imported === 1
          ? t.plugins.artist.imported_assets_one
          : tx(t.plugins.artist.imported_assets_other, { count: imported });
        appendOutput(`[System] ${msg}`);
      }
    } catch {
      // Scan failure is non-critical
    }
  }, [artistFolder, appendOutput, t, tx]);

  // Listen to streaming events
  useEffect(() => {
    const unsubOutput = listen<{ job_id: string; line: string }>(
      EventName.ARTIST_SESSION_OUTPUT,
      (event) => {
        appendOutput(event.payload.line);
        appendCreativeSessionLine(event.payload.job_id, event.payload.line);
      },
    );

    const unsubStatus = listen<{ job_id: string; status: string; error?: string }>(
      EventName.ARTIST_SESSION_STATUS,
      (event) => {
        const { job_id, status, error } = event.payload;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          setRunning(false);
          if (error) {
            const line = `[Error] ${error}`;
            appendOutput(line);
            appendCreativeSessionLine(job_id, line);
          }
          if (status === 'failed') finalizeCreativeSession(job_id, 'failed');
          else if (status === 'cancelled') finalizeCreativeSession(job_id, 'cancelled');
          // 'completed' is finalized in the COMPLETE handler below so the
          // auto-scan has a chance to append its line first.
        }
      },
    );

    const unsubComplete = listen<{ session_id: string; output_lines: number }>(
      EventName.ARTIST_SESSION_COMPLETE,
      (event) => {
        setRunning(false);
        finalizeCreativeSession(event.payload.session_id, 'completed');
        // Auto-scan for new assets after session completes
        scanForNewAssets();
      },
    );

    return () => {
      unsubOutput.then((fn) => fn());
      unsubStatus.then((fn) => fn());
      unsubComplete.then((fn) => fn());
    };
  }, [appendOutput, setRunning, scanForNewAssets, appendCreativeSessionLine, finalizeCreativeSession]);

  return { sessionId, running, output, sendPrompt, cancel, clear };
}
