import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReferenceAttachmentPicker } from "../ReferenceAttachmentPicker";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { open as openDialog } from "@tauri-apps/plugin-dialog";

const mockOpenDialog = openDialog as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockOpenDialog.mockReset();
});

describe("ReferenceAttachmentPicker", () => {
  it("renders idle CTA buttons when no value is set", () => {
    const onChange = vi.fn();
    render(<ReferenceAttachmentPicker value={null} onChange={onChange} />);
    expect(screen.getByTestId("reference-attach-file")).toBeTruthy();
    expect(screen.getByTestId("reference-attach-url")).toBeTruthy();
    expect(screen.getByTestId("reference-attach-inline")).toBeTruthy();
    expect(screen.queryByTestId("reference-attachment-chip")).toBeNull();
  });

  it("opens the file dialog and emits onChange with path + basename when a file is picked", async () => {
    mockOpenDialog.mockResolvedValueOnce("C:\\Users\\me\\Documents\\spec.json");
    const onChange = vi.fn();
    render(<ReferenceAttachmentPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("reference-attach-file"));

    // Wait for the async open() to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(mockOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false }),
    );
    expect(onChange).toHaveBeenCalledWith({
      path: "C:\\Users\\me\\Documents\\spec.json",
      name: "spec.json",
    });
  });

  it("does NOT emit onChange when the file dialog returns null (user cancels)", async () => {
    mockOpenDialog.mockResolvedValueOnce(null);
    const onChange = vi.fn();
    render(<ReferenceAttachmentPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("reference-attach-file"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("URL flow: opens form, accepts a URL, emits onChange with url + url-as-name", () => {
    const onChange = vi.fn();
    render(<ReferenceAttachmentPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("reference-attach-url"));
    const input = screen.getByTestId(
      "reference-attachment-url-input",
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://example.com/openapi.json" },
    });
    fireEvent.click(screen.getByTestId("reference-attachment-url-submit"));

    expect(onChange).toHaveBeenCalledWith({
      url: "https://example.com/openapi.json",
      name: "https://example.com/openapi.json",
    });
  });

  it("Inline flow: opens textarea, accepts content, emits onChange with inlineContent and pasted name", () => {
    const onChange = vi.fn();
    render(<ReferenceAttachmentPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("reference-attach-inline"));
    const ta = screen.getByTestId(
      "reference-attachment-inline-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "{ \"a\": 1 }" } });
    fireEvent.click(screen.getByTestId("reference-attachment-inline-submit"));

    expect(onChange).toHaveBeenCalledWith({
      inlineContent: '{ "a": 1 }',
      name: expect.stringMatching(/pasted/i),
    });
  });

  it("URL form discards whitespace-only input on submit", () => {
    const onChange = vi.fn();
    render(<ReferenceAttachmentPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("reference-attach-url"));
    fireEvent.click(screen.getByTestId("reference-attachment-url-submit"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a chip with file label and clear button when value is a file reference", () => {
    const onChange = vi.fn();
    render(
      <ReferenceAttachmentPicker
        value={{ path: "/tmp/foo.txt", name: "foo.txt" }}
        onChange={onChange}
      />,
    );
    const chip = screen.getByTestId("reference-attachment-chip");
    expect(chip.textContent).toContain("foo.txt");
    fireEvent.click(screen.getByTestId("reference-attachment-clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders the URL on the chip when value is a URL reference", () => {
    render(
      <ReferenceAttachmentPicker
        value={{ url: "https://x.io/a.json", name: "https://x.io/a.json" }}
        onChange={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("reference-attachment-chip");
    expect(chip.textContent).toContain("https://x.io/a.json");
  });

  it("renders inline label on the chip when value is an inline reference", () => {
    render(
      <ReferenceAttachmentPicker
        value={{ inlineContent: "body", name: "pasted reference" }}
        onChange={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("reference-attachment-chip");
    expect(chip.textContent).toContain("pasted reference");
  });
});
