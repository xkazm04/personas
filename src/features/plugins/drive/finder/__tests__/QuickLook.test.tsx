import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { DriveEntry } from "@/api/drive";
import en from "@/i18n/locales/en.json";

// `plugins` is a code-split i18n section served from a generated
// `section-locales/en/plugins.json` chunk, which lags `en.json` until the
// split codegen runs. The source catalog is the truth, so read `t` from it.
vi.mock("@/i18n/useTranslation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/useTranslation")>();
  return {
    ...actual,
    useTranslation: () => ({ t: en, tx: actual.interpolate, language: "en" }),
  };
});

vi.mock("@/api/drive", () => ({
  driveRead: vi.fn(),
  driveReadText: vi.fn(),
}));

// The filmstrip's thumbnails belong to the views package; keep them inert here.
vi.mock("../views/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, failed: false }),
}));

import * as api from "@/api/drive";
import { QuickLook } from "../quicklook/QuickLook";

const entry = (name: string, mime: string | null): DriveEntry => ({
  name,
  path: `dir/${name}`,
  kind: "file",
  size: 12,
  modified: "2026-09-17T10:00:00Z",
  mime,
  extension: name.split(".").pop() ?? null,
});

const entries = [entry("a.png", "image/png"), entry("b.png", "image/png"), entry("c.bin", null)];

describe("QuickLook", () => {
  beforeEach(() => {
    vi.mocked(api.driveRead).mockReset();
    vi.mocked(api.driveRead).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    vi.mocked(api.driveReadText).mockResolvedValue("");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<QuickLook entries={entries} initialPath="dir/a.png" onClose={onClose} onOpenInOs={vi.fn()} />);
    await screen.findByTestId("finder-quicklook");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("steps with the arrow keys and reports each step", async () => {
    const onStep = vi.fn();
    render(
      <QuickLook entries={entries} initialPath="dir/a.png" onClose={vi.fn()} onStep={onStep} onOpenInOs={vi.fn()} />,
    );
    await screen.findByTestId("finder-quicklook");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onStep).toHaveBeenLastCalledWith("dir/b.png");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).toHaveBeenLastCalledWith("dir/a.png");
    // Wraps around at the start.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).toHaveBeenLastCalledWith("dir/c.bin");
  });

  it("renders the unsupported message for a kind it cannot preview", async () => {
    render(<QuickLook entries={entries} initialPath="dir/c.bin" onClose={vi.fn()} onOpenInOs={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("No preview for this kind. Open it with its app instead.")).toBeInTheDocument(),
    );
    expect(api.driveRead).not.toHaveBeenCalled();
  });

  it("hands the current entry to onOpenInOs", async () => {
    const onOpenInOs = vi.fn();
    render(<QuickLook entries={entries} initialPath="dir/b.png" onClose={vi.fn()} onOpenInOs={onOpenInOs} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open with default app" }));
    expect(onOpenInOs).toHaveBeenCalledWith(entries[1]);
  });
});
