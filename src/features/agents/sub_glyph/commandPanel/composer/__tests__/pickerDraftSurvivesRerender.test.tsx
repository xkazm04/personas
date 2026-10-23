/**
 * A picker's draft belongs to the operator from open to apply.
 *
 * Callers hand the pickers fresh arrays on every render (the adoption surface
 * passes `notificationChannels ?? [BUILT_IN_INBOX]` and `subs[id] ?? []`), and
 * a store refresh replaces `personas`. Any of those used to re-seed the draft
 * mid-edit and silently drop what had been picked.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import en from "@/i18n/locales/en.json";
vi.mock("@/i18n/useTranslation", () => ({
  getActiveTranslations: () => en,
  useTranslation: () => ({
    t: en,
    tx: (s: string, v: Record<string, unknown> = {}) =>
      s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? "")),
  }),
}));

const SLACK = {
  name: "slack",
  credentialId: "c1",
  category: "messaging",
  meta: { label: "Slack", color: "#4A154B", iconUrl: null },
};
vi.mock("@/features/agents/shared/quickConfig/useHealthyConnectors", () => ({
  useHealthyConnectors: () => [SLACK],
}));

import { ComposerConnectorsPickerModal } from "../ComposerConnectorsPickerModal";
import { ComposerMessagingPickerModal } from "../ComposerMessagingPickerModal";

describe("composer picker drafts", () => {
  it("connectors: a parent re-render with a fresh `selected` keeps the pick", () => {
    const props = { open: true, onClose: () => {}, onApply: () => {} };
    const { rerender } = render(<ComposerConnectorsPickerModal {...props} selected={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Slack/, pressed: false }));
    expect(screen.getByRole("button", { name: /Slack/, pressed: true })).toBeTruthy();

    rerender(<ComposerConnectorsPickerModal {...props} selected={[]} />);

    expect(screen.getByRole("button", { name: /Slack/, pressed: true })).toBeTruthy();
  });

  it("connectors: re-opening re-seeds from `selected`", () => {
    const props = { onClose: () => {}, onApply: () => {}, selected: [] as string[] };
    const { rerender } = render(<ComposerConnectorsPickerModal {...props} open />);
    fireEvent.click(screen.getByRole("button", { name: /Slack/, pressed: false }));
    rerender(<ComposerConnectorsPickerModal {...props} open={false} />);
    rerender(<ComposerConnectorsPickerModal {...props} open />);
    expect(screen.getByRole("button", { name: /Slack/, pressed: false })).toBeTruthy();
  });

  it("messaging: a fresh fallback array does not re-pin a removed inbox", () => {
    const inbox = () => [
      { type: "built-in" as const, enabled: true, credential_id: null, use_case_ids: "*" as const, event_filter: null, config: null },
    ];
    const props = { open: true, onClose: () => {}, onApply: () => {}, pinBuiltIn: false };
    const { rerender } = render(<ComposerMessagingPickerModal {...props} selected={inbox()} />);
    const builtIn = () => screen.getByRole("checkbox", { name: /Persona inbox/ });
    expect(builtIn().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(builtIn());
    expect(builtIn().getAttribute("aria-checked")).toBe("false");

    rerender(<ComposerMessagingPickerModal {...props} selected={inbox()} />);

    expect(builtIn().getAttribute("aria-checked")).toBe("false");
  });
});
