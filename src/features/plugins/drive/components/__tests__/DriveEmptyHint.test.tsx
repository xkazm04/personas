import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FolderOpen } from "lucide-react";
import { DriveEmptyHint } from "../DriveEmptyHint";

describe("DriveEmptyHint (cycle 22)", () => {
  it("renders title + icon at sm size with no body or CTA", () => {
    render(<DriveEmptyHint size="sm" icon={FolderOpen} title="Empty rail" />);
    expect(screen.getByText("Empty rail")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders body at md/lg sizes when provided", () => {
    render(
      <DriveEmptyHint
        size="lg"
        icon={FolderOpen}
        title="Nothing here"
        body="Agents will save files here."
      />,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.getByText("Agents will save files here.")).toBeTruthy();
  });

  it("renders a CTA button and fires onClick when provided", () => {
    const onClick = vi.fn();
    render(
      <DriveEmptyHint
        size="lg"
        icon={FolderOpen}
        title="Empty"
        cta={{ label: "Create folder", onClick }}
      />,
    );
    const button = screen.getByRole("button", { name: "Create folder" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables the CTA when cta.disabled is true", () => {
    const onClick = vi.fn();
    render(
      <DriveEmptyHint
        size="lg"
        icon={FolderOpen}
        title="Loading"
        cta={{ label: "Run", onClick, disabled: true }}
      />,
    );
    const button = screen.getByRole("button", { name: "Run" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
