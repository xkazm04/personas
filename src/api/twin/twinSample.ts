import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TwinSample } from "@/lib/bindings/TwinSample";
import type { TwinSampleProposal } from "@/lib/bindings/TwinSampleProposal";

// ============================================================================
// Twin learn-from-sample (spark twin-portable-blueprint)
//
// A sample is the user's OWN writing. `learnFromSample` stores it and returns
// at once with status `analyzing`; the analysis runs in the background and
// announces itself with `EventName.TWIN_SAMPLE_UPDATED`, on which the caller
// refetches `sampleProposals`. Proposals change nothing until resolved.
// ============================================================================

/** Where a sample came from. */
export type TwinSampleSourceKind = "selection" | "clipboard" | "forge";
/** What a proposal would change. */
export type TwinSampleProposalKind = "exemplar" | "voice" | "constraint" | "length" | "dims";
/** A proposal's review state. */
export type TwinSampleProposalStatus = "open" | "accepted" | "edited" | "dismissed";
/** A sample's analysis state. */
export type TwinSampleStatus = "analyzing" | "ready" | "failed" | "refused";

/** Store a sample and start its analysis. */
export const learnFromSample = (
  twinId: string,
  text: string,
  sourceKind: TwinSampleSourceKind,
  sourceHost?: string | null,
) =>
  invoke<TwinSample>("twin_learn_from_sample", {
    twinId,
    text,
    sourceKind,
    sourceHost: sourceHost ?? null,
  });

/** The twin's samples, newest first. */
export const sampleList = (twinId: string) =>
  invoke<TwinSample[]>("twin_sample_list", { twinId });

/** The twin's sample proposals, optionally filtered by status, newest first. */
export const sampleProposals = (twinId: string, status?: TwinSampleProposalStatus | null) =>
  invoke<TwinSampleProposal[]>("twin_sample_proposals", { twinId, status: status ?? null });

/**
 * Accept or dismiss one proposal. An accept with `editedValue` writes that
 * value instead and records the proposal as `edited`.
 */
export const sampleResolve = (
  proposalId: string,
  verdict: "accept" | "dismiss",
  editedValue?: string | null,
) =>
  invoke<TwinSampleProposal>("twin_sample_resolve", {
    proposalId,
    verdict,
    editedValue: editedValue ?? null,
  });

/** The OS clipboard's text, read once because the user pressed Learn. */
export const clipboardText = () => invoke<string | null>("twin_clipboard_text");
