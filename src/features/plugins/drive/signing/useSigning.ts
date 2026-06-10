import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 * Convert a stored absolute signature path back to a drive-relative one so it
 * can be matched against Finder entry paths. Signatures store the *absolute*
 * path passed to `sign_document` (root + OS separator + relative); this strips
 * the managed root and normalizes separators to "/". Returns null when the
 * path isn't under the given root (e.g. a sidecar imported from elsewhere).
 */
function toDriveRelative(absPath: string, root: string): string | null {
  if (!root) return null;
  const normAbs = absPath.replace(/\\/g, "/");
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normAbs === normRoot) return "";
  const prefix = `${normRoot}/`;
  return normAbs.startsWith(prefix) ? normAbs.slice(prefix.length) : null;
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
  // Drive root in state (not just the ref) so `signedPaths` recomputes once it
  // resolves — the ref alone wouldn't trigger a re-render.
  const [root, setRoot] = useState<string | null>(null);

  // Cache the drive root so we don't hit Tauri on every sign/verify.
  const rootRef = useRef<string | null>(null);

  const resolveRoot = useCallback(async (): Promise<string> => {
    if (rootRef.current) return rootRef.current;
    const resolved = await driveGetRoot();
    rootRef.current = resolved;
    return resolved;
  }, []);

  // Resolve the root once so the absolute → relative conversion in
  // `signedPaths` has something to strip against.
  useEffect(() => {
    resolveRoot()
      .then(setRoot)
      .catch(silentCatch("signing:resolve-root"));
  }, [resolveRoot]);

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
      } catch (err) {
        // Sidecar absence is the common path; log at silent level so we keep
        // breadcrumbs without surfacing toast noise on every verify attempt.
        silentCatch("signing:sidecar-stat")(err);
        return null;
      }
      try {
        return await driveReadText(candidate);
      } catch (err) {
        silentCatch("signing:sidecar-read")(err);
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

  // Drive-relative paths of every file that carries a signature record. Lets
  // the Finder badge a signed file without each call site re-deriving the
  // absolute → relative mapping. Empty until both the signatures list and the
  // root have loaded; consumers should treat "not present" as "unknown".
  const signedPaths = useMemo(() => {
    const set = new Set<string>();
    if (!root) return set;
    for (const sig of signatures) {
      if (!sig.file_path) continue;
      const rel = toDriveRelative(sig.file_path, root);
      if (rel !== null) set.add(rel);
    }
    return set;
  }, [signatures, root]);

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
    signedPaths,
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
