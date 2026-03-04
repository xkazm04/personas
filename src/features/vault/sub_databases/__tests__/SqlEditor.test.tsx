import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SqlEditor } from "../SqlEditor";

describe("SqlEditor", () => {
  it("renders with placeholder text", () => {
    render(
      <SqlEditor value="" onChange={() => {}} placeholder="Enter SQL query..." />,
    );
    expect(screen.getByPlaceholderText("Enter SQL query...")).toBeInTheDocument();
  });

  it("displays the current value", () => {
    render(
      <SqlEditor value="SELECT * FROM users" onChange={() => {}} />,
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("SELECT * FROM users");
  });

  it("calls onChange when typing", () => {
    const handleChange = vi.fn();
    render(<SqlEditor value="" onChange={handleChange} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "SELECT 1" } });
    expect(handleChange).toHaveBeenCalledWith("SELECT 1");
  });

  it("calls onExecute on Ctrl+Enter", () => {
    const handleExecute = vi.fn();
    render(
      <SqlEditor value="SELECT 1" onChange={() => {}} onExecute={handleExecute} />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(handleExecute).toHaveBeenCalledTimes(1);
  });

  it("calls onExecute on Meta+Enter", () => {
    const handleExecute = vi.fn();
    render(
      <SqlEditor value="SELECT 1" onChange={() => {}} onExecute={handleExecute} />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(handleExecute).toHaveBeenCalledTimes(1);
  });

  it("does not call onExecute on plain Enter", () => {
    const handleExecute = vi.fn();
    render(
      <SqlEditor value="SELECT 1" onChange={() => {}} onExecute={handleExecute} />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(handleExecute).not.toHaveBeenCalled();
  });

  it("renders syntax-highlighted tokens for SQL", () => {
    const { container } = render(
      <SqlEditor value="SELECT * FROM users" onChange={() => {}} language="sql" />,
    );

    // The pre element should contain highlighted spans
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();

    // Check that keyword spans exist (SELECT and FROM should be highlighted)
    const spans = pre!.querySelectorAll("span");
    const keywords = Array.from(spans).filter((s) =>
      s.className.includes("text-blue"),
    );
    expect(keywords.length).toBeGreaterThanOrEqual(2); // SELECT, FROM
  });

  it("renders syntax-highlighted tokens for Redis", () => {
    const { container } = render(
      <SqlEditor value="GET mykey" onChange={() => {}} language="redis" />,
    );

    const pre = container.querySelector("pre");
    const spans = pre!.querySelectorAll("span");
    const keywords = Array.from(spans).filter((s) =>
      s.className.includes("text-blue"),
    );
    expect(keywords.length).toBeGreaterThanOrEqual(1); // GET
  });

  it("highlights SQL strings", () => {
    const { container } = render(
      <SqlEditor value="SELECT 'hello world'" onChange={() => {}} />,
    );

    const pre = container.querySelector("pre");
    const spans = pre!.querySelectorAll("span");
    const strings = Array.from(spans).filter((s) =>
      s.className.includes("text-emerald"),
    );
    expect(strings.length).toBeGreaterThanOrEqual(1);
  });

  it("highlights SQL comments", () => {
    const { container } = render(
      <SqlEditor value="-- this is a comment" onChange={() => {}} />,
    );

    const pre = container.querySelector("pre");
    const spans = pre!.querySelectorAll("span");
    const comments = Array.from(spans).filter((s) =>
      s.className.includes("italic"),
    );
    expect(comments.length).toBeGreaterThanOrEqual(1);
  });

  it("applies minHeight style", () => {
    const { container } = render(
      <SqlEditor value="" onChange={() => {}} minHeight="200px" />,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveStyle({ minHeight: "200px" });
  });
});
