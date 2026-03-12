import { useState, useCallback, useRef } from "react";
import {
  scanCredentialSources,
  importForagedCredential,
  type ForagingScanResult,
} from "@/api/vault/foraging";

export type ForagingPhase = "idle" | "scanning" | "results" | "importing" | "done" | "error";

export interface ForagingState {
  phase: ForagingPhase;
  scanResult: ForagingScanResult | null;
  /** Subset the user has selected for import. */
  selected: Set<string>;
  /** Map of foraged ID -> import result (name, vault ID). */
  imported: Map<string, { id: string; name: string }>;
  /** IDs currently being imported. */
  importingIds: Set<string>;
  error: string | null;
}

export function useCredentialForaging() {
  const [phase, setPhase] = useState<ForagingPhase>("idle");
  const [scanResult, setScanResult] = useState<ForagingScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Map<string, { id: string; name: string }>>(new Map());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const scanningRef = useRef(false);

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setPhase("scanning");
    setError(null);
    setScanResult(null);
    setSelected(new Set());
    setImported(new Map());
    setImportingIds(new Set());

    try {
      const result = await scanCredentialSources();
      setScanResult(result);
      // Auto-select non-imported, high-confidence credentials
      const autoSelected = new Set(
        result.credentials
          .filter((c) => !c.already_imported && c.confidence === "high")
          .map((c) => c.id),
      );
      setSelected(autoSelected);
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      scanningRef.current = false;
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!scanResult) return;
    setSelected(
      new Set(
        scanResult.credentials
          .filter((c) => !c.already_imported)
          .map((c) => c.id),
      ),
    );
  }, [scanResult]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const importSelected = useCallback(
    async (onImported?: () => void) => {
      if (!scanResult || selected.size === 0) return;
      setPhase("importing");

      const toImport = scanResult.credentials.filter((c) => selected.has(c.id));
      const newImported = new Map(imported);
      let hadError = false;

      for (const cred of toImport) {
        setImportingIds((prev) => new Set(prev).add(cred.id));
        try {
          const name = `${cred.label} (Foraged)`;
          const result = await importForagedCredential(cred.id, name, cred.service_type);
          newImported.set(cred.id, { id: result.id, name: result.name });
        } catch (err) {
          console.error(`Failed to import ${cred.label}:`, err);
          hadError = true;
        }
        setImportingIds((prev) => {
          const next = new Set(prev);
          next.delete(cred.id);
          return next;
        });
      }

      setImported(newImported);
      if (hadError) {
        setError("Some credentials could not be imported. They may no longer exist at the source.");
      }
      setPhase("done");
      onImported?.();
    },
    [scanResult, selected, imported],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setScanResult(null);
    setSelected(new Set());
    setImported(new Map());
    setImportingIds(new Set());
    setError(null);
  }, []);

  return {
    phase,
    scanResult,
    selected,
    imported,
    importingIds,
    error,
    scan,
    toggleSelect,
    selectAll,
    selectNone,
    importSelected,
    reset,
  };
}
