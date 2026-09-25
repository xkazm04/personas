/**
 * Promote readiness receipt -- what the build surface does after Promote.
 *
 * The receipt is derived from what the backend VERIFIED about the promoted
 * persona, not from what the promote call guessed. `promote_build_draft`
 * returns `connectors_needing_setup`, which is the agent IR's `has_credential`
 * pre-filter: it can name a connector that is already connected. The same
 * command then runs the connector-readiness resolver and the verification run
 * and writes the result onto the persona row (`setup_status`, the coarse
 * execute gate, and `setup_detail`, a JSON `PersonaSetup` whose `blockers`
 * name each connector still not ready). The receipt reads those two columns,
 * so it never asks the user to connect a service that already works.
 *
 * Pure: no store, no IPC. useLifecycle builds the receipt; UnifiedBuildEntry
 * routes on it.
 */
import type { PersonaSetup } from "@/lib/bindings/PersonaSetup";
import type { SetupBlocker } from "@/lib/bindings/SetupBlocker";
import type { DesignSubTab, EditorTab } from "@/lib/types/types";

export type PromoteReceipt =
  | { kind: "ready" }
  | {
      kind: "needs_setup";
      /** Connector names from the runtime-verified blockers, in order. */
      connectors: string[];
      blockers: SetupBlocker[];
      /** The persona is held (`setup_status` is not ready) but no connector
       *  blocker explains it: the verification run could not deliver value. */
      unverified: boolean;
    }
  | { kind: "failed"; message: string }
  /** A promote was already running; this call did nothing. */
  | { kind: "in_flight" };

/** The promoted persona's own readiness columns, as read back after promote. */
export interface PromotedPersonaReadiness {
  setupStatus: string | null | undefined;
  setupDetail: string | null | undefined;
}

export interface PromoteRedirect {
  editorTab: EditorTab;
  designSubTab?: DesignSubTab;
}

function parseSetup(raw: string | null | undefined): PersonaSetup | null {
  if (!raw) return null;
  try {
    // `setup_detail` is written only by the Rust promote/adoption paths from a
    // serialized `PersonaSetup`; the shape check below guards the one field the
    // receipt routes on, so a row written by an older build degrades to "no
    // detail" instead of throwing.
    const parsed = JSON.parse(raw) as PersonaSetup;
    return Array.isArray(parsed?.blockers) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Derive the receipt from the promoted persona's readiness columns.
 * `null` (the persona could not be read back) keeps today's behaviour: the
 * surface treats the promote as ready and routes to the matrix.
 */
export function derivePromoteReceipt(readiness: PromotedPersonaReadiness | null): PromoteReceipt {
  if (!readiness) return { kind: "ready" };
  const blockers = parseSetup(readiness.setupDetail)?.blockers ?? [];
  const held = readiness.setupStatus != null && readiness.setupStatus !== "ready";
  if (blockers.length === 0 && !held) return { kind: "ready" };
  return {
    kind: "needs_setup",
    connectors: blockers.map((b) => b.connector),
    blockers,
    unverified: blockers.length === 0,
  };
}

/**
 * A promote the backend refused: carry its reason instead of dropping it.
 * An error with no readable reason yields an empty message; the card then
 * shows only its translated title.
 */
export function promoteFailedReceipt(err: unknown): PromoteReceipt {
  const message =
    err instanceof Error ? err.message
    : typeof err === "string" ? err
    : err && typeof err === "object" && (err as Record<string, unknown>).error
      ? String((err as Record<string, unknown>).error)
    : "";
  return { kind: "failed", message };
}

/** Only a clean promote leaves on a timer; anything outstanding holds the surface. */
export function shouldAutoRedirect(receipt: PromoteReceipt | null): boolean {
  return receipt === null || receipt.kind === "ready";
}

/** Where "view the agent" lands: the fix for a held persona lives on Design > Connectors. */
export function redirectTarget(receipt: PromoteReceipt | null): PromoteRedirect {
  if (receipt?.kind === "needs_setup") return { editorTab: "design", designSubTab: "connectors" };
  return { editorTab: "matrix" };
}
