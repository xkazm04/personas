// @vitest-environment node
// Closing the OCR drawer mid-run cancels the backend call, which rejects with
// AppError::Internal("OCR cancelled"). invokeWithTimeout hands that over as the
// serialized AppError OBJECT, so the drawer's old `String(e)` check never saw
// the word and every cancel raised a failure toast plus an assertive
// "[object Object]" announcement.
import { describe, expect, it } from "vitest";

import { isOcrCancellation } from "../useOcr";

describe("isOcrCancellation", () => {
  it("recognises the cancel as the IPC layer actually delivers it", () => {
    expect(
      isOcrCancellation({ error: "OCR cancelled", kind: "internal" }),
    ).toBe(true);
  });

  it("still recognises an Error-wrapped cancel", () => {
    expect(isOcrCancellation(new Error("OCR cancelled"))).toBe(true);
  });

  it("does not swallow a real failure", () => {
    expect(isOcrCancellation({ error: "Gemini API returned 401", kind: "auth" })).toBe(false);
  });
});
