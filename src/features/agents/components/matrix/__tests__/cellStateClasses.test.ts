import { describe, it, expect } from "vitest";
import { getCellStateClasses } from "../cellStateClasses";

describe("cellStateClasses - glow and watermarkOpacity extensions", () => {
  describe("glow field", () => {
    it("filling state has glow-filling class", () => {
      expect(getCellStateClasses("filling").glow).toBe(
        "cell-glow cell-glow-filling"
      );
    });

    it("resolved state has glow-resolved class", () => {
      expect(getCellStateClasses("resolved").glow).toBe(
        "cell-glow cell-glow-resolved"
      );
    });

    it("highlighted state has glow-highlighted class", () => {
      expect(getCellStateClasses("highlighted").glow).toBe(
        "cell-glow cell-glow-highlighted"
      );
    });

    it("hidden state has no glow", () => {
      expect(getCellStateClasses("hidden").glow).toBe("");
    });

    it("pending state has glow-pending class", () => {
      expect(getCellStateClasses("pending").glow).toBe(
        "cell-glow cell-glow-pending"
      );
    });

    it("error state has glow-error class", () => {
      expect(getCellStateClasses("error").glow).toBe(
        "cell-glow cell-glow-error"
      );
    });

    it("revealed state has no glow", () => {
      expect(getCellStateClasses("revealed").glow).toBe("");
    });
  });

  describe("watermarkOpacity field", () => {
    it("filling state returns opacity-[0.15]", () => {
      expect(getCellStateClasses("filling").watermarkOpacity).toBe(
        "opacity-[0.15]"
      );
    });

    it("resolved state returns opacity-[0.20]", () => {
      expect(getCellStateClasses("resolved").watermarkOpacity).toBe(
        "opacity-[0.20]"
      );
    });

    it("revealed state returns opacity-[0.08]", () => {
      expect(getCellStateClasses("revealed").watermarkOpacity).toBe(
        "opacity-[0.08]"
      );
    });

    it("hidden state returns opacity-0", () => {
      expect(getCellStateClasses("hidden").watermarkOpacity).toBe("opacity-0");
    });

    it("pending state returns opacity-[0.10]", () => {
      expect(getCellStateClasses("pending").watermarkOpacity).toBe(
        "opacity-[0.10]"
      );
    });

    it("highlighted state returns opacity-[0.20]", () => {
      expect(getCellStateClasses("highlighted").watermarkOpacity).toBe(
        "opacity-[0.20]"
      );
    });

    it("error state returns opacity-[0.15]", () => {
      expect(getCellStateClasses("error").watermarkOpacity).toBe(
        "opacity-[0.15]"
      );
    });
  });
});
