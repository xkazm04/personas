import { describe, it, expect } from "vitest";
import {
  kindBucketWeight,
  kindGroupLabel,
  kindLabel,
  visualForEntry,
  formatRelativeTime,
} from "../designTokens";
import type { DriveEntry } from "@/api/drive";
import type { Translations } from "@/i18n/en";

// Minimal stub of the translations surface — only the keys these helpers
// touch are defined. The helpers only read flat strings under
// `t.plugins.drive.*` so casting is safe.
const t = {
  plugins: {
    drive: {
      folder_kind: "Folder",
      kind_folder: "Folder",
      kind_image: "Image",
      kind_audio: "Audio",
      kind_video: "Video",
      kind_pdf: "PDF",
      kind_code: "Code",
      kind_data: "Data",
      kind_sheet: "Sheet",
      kind_archive: "Archive",
      kind_text: "Document",
      kind_signature: "Signature",
      kind_generic: "File",
      group_folders: "Folders",
      group_images: "Images",
      group_audio: "Audio",
      group_videos: "Videos",
      group_pdfs: "PDFs",
      group_code: "Code",
      group_data: "Data",
      group_sheets: "Sheets",
      group_archives: "Archives",
      group_documents: "Documents",
      group_signatures: "Signatures",
      group_other: "Other",
      time_just_now: "just now",
      time_minutes_ago_one: "{count}m ago",
      time_minutes_ago_other: "{count}m ago",
      time_hours_ago_one: "{count}h ago",
      time_hours_ago_other: "{count}h ago",
      time_yesterday: "yesterday",
      time_days_ago_one: "{count}d ago",
      time_days_ago_other: "{count}d ago",
    },
  },
} as unknown as Translations;

const tx = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));

function entry(overrides: Partial<DriveEntry> = {}): DriveEntry {
  return {
    name: "file.txt",
    path: "file.txt",
    kind: "file",
    size: 100,
    modified: new Date().toISOString(),
    mime: "text/plain",
    extension: "txt",
    ...overrides,
  };
}

describe("kindBucketWeight (cycle 6 — curated order)", () => {
  // Folders → Images → Videos → PDFs → Documents → Code → Data → Sheets
  // → Audio → Archives → Signatures → Other. Lower weight = earlier.
  it("places folders first", () => {
    expect(kindBucketWeight("kind_folder")).toBe(0);
  });

  it("places images before videos before pdfs", () => {
    expect(kindBucketWeight("kind_image")).toBeLessThan(
      kindBucketWeight("kind_video"),
    );
    expect(kindBucketWeight("kind_video")).toBeLessThan(
      kindBucketWeight("kind_pdf"),
    );
  });

  it("places documents (text) before code before data before sheets", () => {
    expect(kindBucketWeight("kind_text")).toBeLessThan(
      kindBucketWeight("kind_code"),
    );
    expect(kindBucketWeight("kind_code")).toBeLessThan(
      kindBucketWeight("kind_data"),
    );
    expect(kindBucketWeight("kind_data")).toBeLessThan(
      kindBucketWeight("kind_sheet"),
    );
  });

  it("places generic ('Other') last", () => {
    const others = [
      "kind_folder",
      "kind_image",
      "kind_audio",
      "kind_video",
      "kind_pdf",
      "kind_code",
      "kind_data",
      "kind_sheet",
      "kind_archive",
      "kind_text",
      "kind_signature",
    ] as const;
    for (const k of others) {
      expect(kindBucketWeight(k)).toBeLessThan(
        kindBucketWeight("kind_generic"),
      );
    }
  });
});

describe("kindGroupLabel (cycle 2 — plural labels)", () => {
  it("maps each kind to its plural form", () => {
    expect(kindGroupLabel(t, "kind_folder")).toBe("Folders");
    expect(kindGroupLabel(t, "kind_image")).toBe("Images");
    expect(kindGroupLabel(t, "kind_video")).toBe("Videos");
    expect(kindGroupLabel(t, "kind_pdf")).toBe("PDFs");
    expect(kindGroupLabel(t, "kind_text")).toBe("Documents");
    expect(kindGroupLabel(t, "kind_code")).toBe("Code");
    expect(kindGroupLabel(t, "kind_data")).toBe("Data");
    expect(kindGroupLabel(t, "kind_sheet")).toBe("Sheets");
    expect(kindGroupLabel(t, "kind_audio")).toBe("Audio");
    expect(kindGroupLabel(t, "kind_archive")).toBe("Archives");
    expect(kindGroupLabel(t, "kind_signature")).toBe("Signatures");
    expect(kindGroupLabel(t, "kind_generic")).toBe("Other");
  });
});

describe("visualForEntry (mime → bucket routing)", () => {
  it("routes folders by kind, not mime", () => {
    const e = entry({ kind: "folder", mime: null, extension: null });
    expect(visualForEntry(e).labelKey).toBe("kind_folder");
  });

  it("recognises images by mime prefix", () => {
    expect(visualForEntry(entry({ mime: "image/png" })).labelKey).toBe(
      "kind_image",
    );
  });

  it("recognises PDFs by mime", () => {
    expect(
      visualForEntry(entry({ mime: "application/pdf" })).labelKey,
    ).toBe("kind_pdf");
  });

  it("recognises .sig signature files by extension", () => {
    expect(visualForEntry(entry({ extension: "sig" })).labelKey).toBe(
      "kind_signature",
    );
    expect(
      visualForEntry(
        entry({ name: "report.sig.json", extension: "json" }),
      ).labelKey,
    ).toBe("kind_signature");
  });

  it("falls through to generic for unrecognised mime", () => {
    expect(
      visualForEntry(entry({ mime: "application/octet-stream", extension: "bin" }))
        .labelKey,
    ).toBe("kind_generic");
  });

  it("opens folder shows the open variant", () => {
    const e = entry({ kind: "folder" });
    expect(visualForEntry(e, true).Icon).not.toBe(visualForEntry(e, false).Icon);
  });
});

describe("kindLabel (singular)", () => {
  it("returns the label associated with the visual", () => {
    const visual = visualForEntry(entry({ mime: "image/jpeg" }));
    expect(kindLabel(t, visual)).toBe("Image");
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for sub-minute deltas", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now, t, tx)).toBe("just now");
  });

  it("returns minutes-ago for sub-hour deltas", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatRelativeTime(tenMinutesAgo, t, tx)).toBe("10m ago");
  });

  it("returns hours-ago for sub-day deltas", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatRelativeTime(threeHoursAgo, t, tx)).toBe("3h ago");
  });

  it("returns 'yesterday' for 1-day-ago", () => {
    const oneDayAgo = new Date(Date.now() - 30 * 3600_000).toISOString();
    expect(formatRelativeTime(oneDayAgo, t, tx)).toBe("yesterday");
  });

  it("returns days-ago for sub-week deltas", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(formatRelativeTime(threeDaysAgo, t, tx)).toBe("3d ago");
  });

  it("returns a locale date for older entries", () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const formatted = formatRelativeTime(twoMonthsAgo, t, tx);
    // Locale date format — exact value depends on host locale but should
    // not equal any of the relative-time tokens above.
    expect(formatted).not.toMatch(/just now|ago|yesterday/);
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("returns the input on invalid ISO", () => {
    expect(formatRelativeTime("not-a-date", t, tx)).toBe("not-a-date");
  });
});
