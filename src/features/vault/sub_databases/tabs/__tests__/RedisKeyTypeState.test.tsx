import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TableDetailPanel, type KeyTypeState } from "../TableDetailPanel";
import { getActiveTranslations } from "@/i18n/useTranslation";

/**
 * `TYPE <key>` failing used to be modelled as a VALUE: the catch wrote the
 * translated word "Error" into the same state slot a real Redis type goes in,
 * and the renderer — having no failure branch — painted it inside the amber
 * type badge with the "use the console on this key" hint underneath.
 */
const noop = () => {};

function renderPanel(keyType: KeyTypeState, onRetryKeyType = noop) {
  return render(
    <TableDetailPanel
      isRedis
      selectedTable={null}
      selectedKey="session:42"
      keyType={keyType}
      onRetryKeyType={onRetryKeyType}
      tables={[]}
      columns={[]}
      columnsLoading={false}
      columnsError={null}
      isPinned={false}
      onPinTable={noop}
    />,
  );
}

describe("Redis key TYPE lookup — three states, not a nullable string", () => {
  it("renders a successful lookup in the type badge", () => {
    renderPanel({ status: "ok", type: "hash" });
    expect(screen.getByTestId("db-redis-key-type").textContent).toBe("hash");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a failure as an error with a retry — never inside the type badge", () => {
    const onRetry = vi.fn();
    renderPanel({ status: "error", message: "WRONGTYPE connection lost" }, onRetry);

    // The badge must not exist at all: an error is not a type.
    expect(screen.queryByTestId("db-redis-key-type")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("WRONGTYPE connection lost");

    fireEvent.click(screen.getByRole("button", { name: /retry|reintentar|réessayer/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not show the use-the-console hint when the lookup failed", () => {
    const { container } = renderPanel({ status: "error", message: "connection refused" });
    // The hint asserts the lookup SUCCEEDED ("use the console on this key"),
    // so it must not survive into the failure branch.
    const hint = getActiveTranslations().vault.databases.use_console_hint;
    expect(container.textContent).not.toContain(hint);
  });

  it("still paints the calm ghost while the lookup is in flight", () => {
    renderPanel({ status: "loading" });
    expect(screen.queryByTestId("db-redis-key-type")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
