import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WebhookSourcePicker } from "../WebhookSourcePicker";

vi.mock("@/api/system/system", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

import { openExternalUrl } from "@/api/system/system";

const mockOpen = openExternalUrl as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockOpen.mockReset();
  mockOpen.mockResolvedValue(undefined);
});

describe("WebhookSourcePicker", () => {
  it("renders the form with URL + filter inputs and the create-channel link", () => {
    render(<WebhookSourcePicker value={null} onChange={vi.fn()} />);
    expect(screen.getByTestId("webhook-source-url-input")).toBeTruthy();
    expect(screen.getByTestId("webhook-source-filter-input")).toBeTruthy();
    expect(screen.getByTestId("webhook-source-create-channel")).toBeTruthy();
    expect(screen.getByTestId("webhook-source-attach-button")).toBeTruthy();
  });

  it("disables the attach button until a valid smee.io URL is entered", () => {
    render(<WebhookSourcePicker value={null} onChange={vi.fn()} />);
    const btn = screen.getByTestId("webhook-source-attach-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("webhook-source-url-input"), {
      target: { value: "https://smee.io/abc" },
    });
    expect(btn.disabled).toBe(false);
  });

  it("shows a format error after blur for non-smee URLs", () => {
    render(<WebhookSourcePicker value={null} onChange={vi.fn()} />);
    const input = screen.getByTestId("webhook-source-url-input");
    fireEvent.change(input, { target: { value: "https://example.com/hook" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("webhook-source-url-error")).toBeTruthy();
  });

  it("emits onChange with channelUrl + optional eventFilter on attach", () => {
    const onChange = vi.fn();
    render(<WebhookSourcePicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("webhook-source-url-input"), {
      target: { value: "  https://smee.io/abc  " },
    });
    fireEvent.change(screen.getByTestId("webhook-source-filter-input"), {
      target: { value: "github.push,github.pull_request" },
    });
    fireEvent.click(screen.getByTestId("webhook-source-attach-button"));

    expect(onChange).toHaveBeenCalledWith({
      channelUrl: "https://smee.io/abc",
      eventFilter: "github.push,github.pull_request",
    });
  });

  it("omits eventFilter from the payload when the filter input is blank", () => {
    const onChange = vi.fn();
    render(<WebhookSourcePicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("webhook-source-url-input"), {
      target: { value: "https://smee.io/abc" },
    });
    fireEvent.change(screen.getByTestId("webhook-source-filter-input"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("webhook-source-attach-button"));

    const arg = onChange.mock.calls[0]?.[0];
    expect(arg.channelUrl).toBe("https://smee.io/abc");
    expect(arg.eventFilter).toBeUndefined();
  });

  it("submit on Enter inside the URL input also fires onChange", () => {
    const onChange = vi.fn();
    render(<WebhookSourcePicker value={null} onChange={onChange} />);

    const url = screen.getByTestId("webhook-source-url-input");
    fireEvent.change(url, { target: { value: "https://smee.io/abc" } });
    fireEvent.keyDown(url, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({
      channelUrl: "https://smee.io/abc",
      eventFilter: undefined,
    });
  });

  it("create-channel button calls openExternalUrl with smee.io/new", () => {
    render(<WebhookSourcePicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("webhook-source-create-channel"));
    expect(mockOpen).toHaveBeenCalledWith("https://smee.io/new");
  });

  it("renders a chip with channel URL + filter and clear button when value is set", () => {
    const onChange = vi.fn();
    render(
      <WebhookSourcePicker
        value={{ channelUrl: "https://smee.io/xyz", eventFilter: "a,b" }}
        onChange={onChange}
      />,
    );
    const chip = screen.getByTestId("webhook-source-chip");
    expect(chip.textContent).toContain("https://smee.io/xyz");
    expect(chip.textContent).toContain("[a,b]");

    fireEvent.click(screen.getByTestId("webhook-source-clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("chip omits the filter brackets when no eventFilter is set", () => {
    render(
      <WebhookSourcePicker
        value={{ channelUrl: "https://smee.io/xyz" }}
        onChange={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("webhook-source-chip");
    expect(chip.textContent).toContain("https://smee.io/xyz");
    expect(chip.textContent).not.toContain("[");
  });
});
