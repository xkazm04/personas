import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TwinCardExportOptions } from "@/lib/bindings/TwinCardExportOptions";
import type { TwinCardExportResult } from "@/lib/bindings/TwinCardExportResult";
import type { TwinCardImportResult } from "@/lib/bindings/TwinCardImportResult";
import type { TwinCardInspection } from "@/lib/bindings/TwinCardInspection";

// ============================================================================
// Twin Card v1.0 (spark twin-portable-blueprint)
//
// The portable twin file, specified in docs/standards/twin-card/1.0/. Export
// writes one twin to a path the caller chose in a save dialog; inspect reads a
// card without importing it (version support, validity, partitions, signature);
// import creates (or replaces) a twin from it.
// ============================================================================

/** A card partition. `voice` (with identity) is always written. */
export type TwinCardPartition = "voice" | "knowledge" | "training" | "evidence";
/** `twin-card` is the standard; `ccv3` is a Character Card V3 carrying it. */
export type TwinCardFormat = "twin-card" | "ccv3";
/** What to do when a twin with the card's name already exists. */
export type TwinCardConflict = "duplicate" | "replace" | "skip";
/** A card's signature as `inspect` found it. */
export type TwinCardSignatureState = "valid" | "invalid" | "unsigned";

/** Sealing (PBKDF2) is deliberately slow; give export and import room. */
const CARD_TIMEOUT_MS = 60_000;

/** Export one twin as a card. `passphrase` (>= 8 chars) seals the personal partitions. */
export const cardExport = (twinId: string, options: TwinCardExportOptions, passphrase?: string | null) =>
  invoke<TwinCardExportResult>(
    "twin_card_export",
    { twinId, options, passphrase: passphrase ?? null },
    { timeoutMs: CARD_TIMEOUT_MS },
  );

/** Read a card without importing it. */
export const cardInspect = (path: string, passphrase?: string | null) =>
  invoke<TwinCardInspection>(
    "twin_card_inspect",
    { path, passphrase: passphrase ?? null },
    { timeoutMs: CARD_TIMEOUT_MS },
  );

/** Import a card as a twin. */
export const cardImport = (path: string, passphrase: string | null, conflict: TwinCardConflict) =>
  invoke<TwinCardImportResult>(
    "twin_card_import",
    { path, passphrase, conflict },
    { timeoutMs: CARD_TIMEOUT_MS },
  );
