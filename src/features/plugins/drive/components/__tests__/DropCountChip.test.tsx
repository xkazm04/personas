import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DropCountChip } from "../DropCountChip";

describe("DropCountChip (cycle 33)", () => {
  it("renders the count number", () => {
    render(<DropCountChip count={3} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders single-digit and double-digit counts", () => {
    const { rerender } = render(<DropCountChip count={1} />);
    expect(screen.getByText("1")).toBeTruthy();
    rerender(<DropCountChip count={42} />);
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("is aria-hidden — purely decorative reinforcement", () => {
    const { container } = render(<DropCountChip count={5} />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });
});
