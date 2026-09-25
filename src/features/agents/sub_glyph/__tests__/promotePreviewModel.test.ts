/** Promote preview view model: what the Glyph approval shows before the click.
 *
 *  Only a refusal disables Promote (promote would throw anyway); a slow or
 *  failed preview never blocks it. scan-sweep challenge-2026-09-23, commands-design B.
 */
import { describe, it, expect } from "vitest";

import type { PromotePreview } from "@/lib/bindings/PromotePreview";
import { toPromoteView } from "../promotePreviewModel";

const promotable = (over: Partial<PromotePreview> = {}): PromotePreview => ({
  promotable: true,
  refusal: null,
  setup: {
    blockers: [{ connector: "gmail", kind: "vault_credential", detail: "`gmail` needs a credential" }],
    has_autonomous_trigger: true,
    triggers: ["schedule"],
    preview: "Needs setup before it can deliver value.",
    notes: ["trigger[0].config.cron: '{{param.hour}}' -> '0 9 * * *'"],
  },
  nextFires: [
    { triggerType: "schedule", description: "daily", nextFireAt: "2026-09-25T09:00:00+00:00" },
    { triggerType: "webhook", description: null, nextFireAt: null },
  ],
  ...over,
});

describe("toPromoteView", () => {
  it("a refusal disables promote and names the reason", () => {
    const view = toPromoteView({
      promotable: false,
      refusal: "Polling URL blocked: link-local address",
      setup: null,
      nextFires: [],
    });
    expect(view).toMatchObject({
      canPromote: false,
      reason: "Polling URL blocked: link-local address",
    });
  });

  it("a promotable preview with one blocker still promotes and lists the setup", () => {
    const view = toPromoteView(promotable());
    expect(view).toMatchObject({ canPromote: true, reason: null, needsSetup: ["gmail"] });
    expect(view.repairs).toEqual(["trigger[0].config.cron: '{{param.hour}}' -> '0 9 * * *'"]);
    expect(view.fires).toEqual([
      { triggerType: "schedule", description: "daily", nextFireAt: "2026-09-25T09:00:00+00:00" },
      { triggerType: "webhook", description: null, nextFireAt: null },
    ]);
  });

  it("no preview (loading or failed) never blocks promote", () => {
    const view = toPromoteView(null);
    expect(view).toMatchObject({ canPromote: true, reason: null, needsSetup: [], fires: [] });
    expect(view.hasContent).toBe(false);
  });

  it("a promotable preview with nothing to report has no content", () => {
    const view = toPromoteView(
      promotable({
        setup: { blockers: [], has_autonomous_trigger: false, triggers: [], preview: "", notes: [] },
        nextFires: [],
      }),
    );
    expect(view.hasContent).toBe(false);
  });
});
