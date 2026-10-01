/**
 * The import flow's state, kept out of the dialog so the dialog only renders:
 * pick a file -> inspect it (version support, validity, partitions, signature)
 * -> a passphrase when a partition is sealed -> a conflict choice when a twin
 * with the card's name exists -> import -> refresh the roster.
 *
 * Inspect reads the card without writing anything, so a failed or unsupported
 * card never reaches the database. Every rejection is answered inline in the
 * dialog the user is looking at.
 */
import { useCallback, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { cardImport, cardInspect, type TwinCardConflict } from '@/api/twin/twinCard';
import type { TwinCardImportResult } from '@/lib/bindings/TwinCardImportResult';
import type { TwinCardInspection } from '@/lib/bindings/TwinCardInspection';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { describeTwinError } from './cardErrors';

export interface TwinCardImportFlow {
  path: string | null;
  inspection: TwinCardInspection | null;
  error: string | null;
  passphrase: string;
  setPassphrase: (value: string) => void;
  conflict: TwinCardConflict;
  setConflict: (value: TwinCardConflict) => void;
  /** Some partition is sealed: the passphrase field shows. */
  sealed: boolean;
  /** The card cannot be imported at all (newer major version, or not a valid card). */
  blocked: boolean;
  /** The name of the existing twin the card collides with, or null. */
  conflictName: string | null;
  /** Open the OS file dialog and inspect the pick. Resolves when the inspection settles. */
  pick: () => Promise<void>;
  /** Import with the current choices; resolves the result, or null when it failed (the error is set). */
  runImport: () => Promise<TwinCardImportResult | null>;
}

function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'accent' }) === 0;
}

export function useTwinCardImport(): TwinCardImportFlow {
  const profiles = useSystemStore((s) => s.twinProfiles);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const [path, setPath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<TwinCardInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [conflict, setConflict] = useState<TwinCardConflict>('duplicate');

  const pick = useCallback(async () => {
    setError(null);
    try {
      const chosen = await open({ multiple: false, filters: [{ name: 'Twin Card', extensions: ['json'] }] });
      // `multiple: false` makes this string | null.
      if (typeof chosen !== 'string') return;
      setPath(chosen);
      setInspection(null);
      setPassphrase('');
      setInspection(await cardInspect(chosen, null));
    } catch (err) {
      silentCatch('twin:card:inspect')(err);
      setError(describeTwinError(err));
    }
  }, []);

  const conflictName = useMemo(() => {
    const name = inspection?.name;
    if (!name) return null;
    return profiles.find((p) => sameName(p.name, name))?.name ?? null;
  }, [inspection, profiles]);

  const sealed = inspection?.partitions.some((p) => p.sealed) ?? false;
  const blocked = inspection !== null && (!inspection.supported || !inspection.valid);

  const runImport = useCallback(async (): Promise<TwinCardImportResult | null> => {
    if (!path || !inspection || blocked) return null;
    setError(null);
    try {
      const result = await cardImport(path, passphrase ? passphrase : null, conflictName ? conflict : 'duplicate');
      await fetchTwinProfiles({ force: true });
      return result;
    } catch (err) {
      silentCatch('twin:card:import')(err);
      setError(describeTwinError(err));
      return null;
    }
  }, [path, inspection, blocked, passphrase, conflictName, conflict, fetchTwinProfiles]);

  return {
    path, inspection, error, passphrase, setPassphrase, conflict, setConflict,
    sealed, blocked, conflictName, pick, runImport,
  };
}
