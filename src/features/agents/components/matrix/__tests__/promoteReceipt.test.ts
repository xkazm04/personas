import { describe, it, expect } from "vitest";
import {
  derivePromoteReceipt,
  promoteFailedReceipt,
  redirectTarget,
  shouldAutoRedirect,
} from "../promoteReceipt";
import type { PersonaSetup } from "@/lib/bindings/PersonaSetup";

// The receipt is derived from what the backend VERIFIED about the promoted
// persona (`personas.setup_status` + `personas.setup_detail`, written by
// promote_build_draft after the connector-readiness resolver and the
// verification run), never from the promote JSON's `connectors_needing_setup`
// pre-filter, which lists connectors the IR flagged whether or not they are
// already connected.

function setupJson(overrides: Partial<PersonaSetup> = {}): string {
  const setup: PersonaSetup = {
    blockers: [],
    has_autonomous_trigger: false,
    triggers: ["manual"],
    preview: "Runs when you start it.",
    notes: [],
    ...overrides,
  };
  return JSON.stringify(setup);
}

describe("derivePromoteReceipt", () => {
  it("case 2: runtime-verified blockers -> needs_setup naming each connector, and no auto-redirect", () => {
    const receipt = derivePromoteReceipt({
      setupStatus: "needs_credentials",
      setupDetail: setupJson({
        blockers: [
          { connector: "gmail", kind: "vault_credential", detail: "gmail: add a credential" },
          { connector: "slack", kind: "vault_credential", detail: "slack: add a credential" },
        ],
      }),
    });

    expect(receipt.kind).toBe("needs_setup");
    expect(receipt.kind === "needs_setup" && receipt.connectors).toEqual(["gmail", "slack"]);
    expect(shouldAutoRedirect(receipt)).toBe(false);
  });

  it("case 5: a persona the verification run downgraded (no connector blocker) is never presented as ready", () => {
    const receipt = derivePromoteReceipt({
      setupStatus: "needs_credentials",
      setupDetail: setupJson({ blockers: [] }),
    });

    expect(receipt.kind).toBe("needs_setup");
    expect(receipt.kind === "needs_setup" && receipt.connectors).toEqual([]);
    expect(receipt.kind === "needs_setup" && receipt.unverified).toBe(true);
    expect(shouldAutoRedirect(receipt)).toBe(false);
  });

  it("[guard] a clean promote (ready, no blockers) -> ready, auto-redirects to the matrix", () => {
    const receipt = derivePromoteReceipt({ setupStatus: "ready", setupDetail: setupJson() });

    expect(receipt).toEqual({ kind: "ready" });
    expect(shouldAutoRedirect(receipt)).toBe(true);
    expect(redirectTarget(receipt)).toEqual({ editorTab: "matrix" });
  });

  it("unreadable setup detail falls back to the coarse status instead of throwing", () => {
    expect(derivePromoteReceipt({ setupStatus: "ready", setupDetail: "{not json" })).toEqual({ kind: "ready" });
    expect(derivePromoteReceipt(null)).toEqual({ kind: "ready" });
  });
});

describe("redirectTarget", () => {
  it("case 3: a needs_setup receipt lands on Design > Connectors, where the fix lives", () => {
    const receipt = derivePromoteReceipt({
      setupStatus: "needs_credentials",
      setupDetail: setupJson({
        blockers: [{ connector: "gmail", kind: "vault_credential", detail: "gmail" }],
      }),
    });

    expect(redirectTarget(receipt)).toEqual({ editorTab: "design", designSubTab: "connectors" });
  });

  it("no receipt held keeps today's route", () => {
    expect(shouldAutoRedirect(null)).toBe(true);
    expect(redirectTarget(null)).toEqual({ editorTab: "matrix" });
  });
});

describe("promoteFailedReceipt", () => {
  it("carries the backend's reason from an IPC error object", () => {
    expect(promoteFailedReceipt({ error: "Build session agent_ir parse error: x", kind: "Validation" })).toEqual({
      kind: "failed",
      message: "Build session agent_ir parse error: x",
    });
    expect(promoteFailedReceipt(new Error("boom"))).toEqual({ kind: "failed", message: "boom" });
    expect(promoteFailedReceipt("plain")).toEqual({ kind: "failed", message: "plain" });
    expect(shouldAutoRedirect(promoteFailedReceipt(null))).toBe(false);
  });
});
