import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDocumentSignature,
  exportSignatureSidecar,
  generateSigningKey,
  listDocumentSignatures,
  signDocument,
  verifyDocument,
  type DocumentSignature,
  type SignDocumentResult,
  type VerifyDocumentResult,
} from "@/api/signing";
import {
  driveGetRoot,
  driveReadText,
  driveStat,
  driveWriteText,
} from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";

export interface SigningIdentity {
  peerId: string;
  displayName: string;
}

/**
 * Bridge hook between the Drive plugin and the signing backend. Wraps the
 * absolute-path `sign_document` / `verify_document` commands with
 * drive-relative helpers so the Finder UI can sign any file in the managed
 * root, write sidecars next to them, and auto-look up sidecars on verify.
 *
 * The hook is cheap to mount — it only fetches the signing identity lazily
 * and defers the history query until `refreshSignatures()` is called.
 */
export function useSigning() {
  const [identity, setIdentity] = useState<SigningIdentity | null>(null);
  const [signatures, setSignatures] = useState<DocumentSignature[]>([]);
  const [loadingSignatures, setLoadingSignatures] = useState(false);

  // Cache the drive root so we don't hit Tauri on every sign/verify.
  const rootRef = useRef<string | null>(null);

  const resolveRoot = useCallback(async (): Promise<string> => {
    if (rootRef.current) return rootRef.current;
    const root = await driveGetRoot();
    rootRef.current = root;
    return root;
  }, []);

  const ensureIdentity = useCallback(async (): Promise<SigningIdentity> => {
    if (identity) return identity;
    const res = await generateSigningKey();
    const next: SigningIdentity = {
      peerId: res.peer_id,
      displayName: res.display_name,
    };
    setIdentity(next);
    return next;
  }, [identity]);

  // Best-effort identity preload so the sign dialog can show "Signing as ...".
  useEffect(() => {
    ensureIdentity().catch(silentCatch("signing:identity"));
  }, [ensureIdentity]);

  const refreshSignatures = useCallback(async () => {
    setLoadingSignatures(true);
    try {
      const rows = await listDocumentSignatures();
      setSignatures(rows);
    } catch (e) {
      silentCatch("signing:list")(e);
    } finally {
      setLoadingSignatures(false);
    }
  }, []);

  /**
   * Sign a drive-relative file. Returns the raw backend result plus the
   * path (drive-relative) where a `.sig.json` sidecar can be written.
   */
  const signDriveFile = useCallback(
    async (drivePath: string, metadata?: string): Promise<SignDocumentResult> => {
      await ensureIdentity();
      const root = await resolveRoot();
      const sep = root.includes("\\") ? "\\" : "/";
      const abs = `${root}${sep}${drivePath.replace(/\//g, sep)}`;
      const result = await signDocument(abs, metadata);
      return result;
    },
    [ensureIdentity, resolveRoot],
  );

  /**
   * Write a sidecar JSON payload to the drive as `<drivePath>.sig.json`.
   */
  const writeSidecarToDrive = useCallback(
    async (drivePath: string, sidecarJson: string): Promise<string> => {
      const sidecarRel = `${drivePath}.sig.json`;
      await driveWriteText(sidecarRel, sidecarJson);
      return sidecarRel;
    },
    [],
  );

  /**
   * Try to locate a `.sig.json` sidecar for a drive-relative file. Returns
   * the parsed sidecar JSON as a string, or null if none exists.
   */
  const findSidecarInDrive = useCallback(
    async (drivePath: string): Promise<string | null> => {
      const candidate = `${drivePath}.sig.json`;
      try {
        await driveStat(candidate);
      } catch {
        return null;
      }
      try {
        return await driveReadText(candidate);
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Verify a drive-relative file against an explicit sidecar JSON payload.
   * Converts the drive path to absolute before dispatching to the backend.
   */
  const verifyDriveFile = useCallback(
    async (
      drivePath: string,
      sidecarJson: string,
    ): Promise<VerifyDocumentResult> => {
      const root = await resolveRoot();
      const sep = root.includes("\\") ? "\\" : "/";
      const abs = `${root}${sep}${drivePath.replace(/\//g, sep)}`;
      return verifyDocument(abs, sidecarJson);
    },
    [resolveRoot],
  );

  const removeSignature = useCallback(
    async (id: string) => {
      await deleteDocumentSignature(id);
      await refreshSignatures();
    },
    [refreshSignatures],
  );

  const exportSidecarJson = useCallback(async (id: string): Promise<string> => {
    return exportSignatureSidecar(id);
  }, []);

  // NOTE: consumers that put the returned object in a useEffect dep array
  // will re-fire the effect whenever `signatures` / `loadingSignatures`
  // change — which causes an infinite loop if the effect itself triggers
  // a refresh. Each callback below is individually memoised via useCallback,
  // so downstream effects should destructure and depend on the specific
  // callbacks they need (e.g. `const { refreshSignatures } = signing`) and
  // list *those* in the dep array, not the whole `signing` object.
  return {
    identity,
    signatures,
    loadingSignatures,
    ensureIdentity,
    refreshSignatures,
    signDriveFile,
    writeSidecarToDrive,
    findSidecarInDrive,
    verifyDriveFile,
    removeSignature,
    exportSidecarJson,
  };
}
