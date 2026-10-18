/**
 * The composer pickers to assistive tech: a named modal dialog, and every
 * toggle says whether it is on. Selection used to be colour-only on the
 * rhythm cards, the weekday and day-of-month buttons and the connector cards,
 * while sibling controls (event templates, the filter toggle, table scope)
 * already exposed it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import en from "@/i18n/locales/en.json";
vi.mock("@/i18n/useTranslation", () => ({
  getActiveTranslations: () => en,
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { ComposerSchedulePickerModal } from "../ComposerSchedulePickerModal";
import { ComposerScheduleRhythmCard } from "../ComposerScheduleRhythmCard";
import { ComposerConnectorCard } from "../ComposerConnectorCard";

describe("composer picker a11y", () => {
  it("opens as a named modal dialog with pressed-state weekday toggles", () => {
    render(
      <ComposerSchedulePickerModal
        open
        onClose={() => {}}
        frequency="weekly"
        days={["mon"]}
        monthDay={1}
        time="09:00"
        onApply={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mon", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tue", pressed: false })).toBeTruthy();
    expect(screen.getByLabelText("Time")).toBeTruthy();
  });

  it("exposes a rhythm card's selection", () => {
    render(
      <ComposerScheduleRhythmCard rhythm="daily" icon={null} title="Daily" caption="every day" active onSelect={() => {}} />,
    );
    expect(screen.getByRole("button", { pressed: true })).toBeTruthy();
  });

  it("exposes a connector card's selection", () => {
    const connector = {
      name: "slack",
      credentialId: "c1",
      category: "messaging",
      meta: { label: "Slack", color: "#4A154B", iconUrl: null },
    };
    render(<ComposerConnectorCard connector={connector as never} selected={false} onToggle={() => {}} />);
    expect(screen.getByRole("button", { pressed: false })).toBeTruthy();
  });
});
