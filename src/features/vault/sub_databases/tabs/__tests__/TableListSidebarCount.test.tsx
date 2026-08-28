import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TableListSidebar } from "../TableListSidebar";
import type { IntrospectedTable, RedisKeyInfo } from "@/hooks/database/useTableIntrospection";

/**
 * The footer count used to read the UNFILTERED array while the list above it
 * rendered the filtered one, so filtering 50 tables down to 3 still reported
 * 50. Only the zero-match case was ever handled.
 */
function makeTables(n: number): IntrospectedTable[] {
  return Array.from({ length: n }, (_, i) => ({
    table_name: i < 3 ? `users_${i}` : `orders_${i}`,
    table_type: "TABLE",
  })) as IntrospectedTable[];
}

const noop = () => {};

function renderSidebar(props: Partial<Parameters<typeof TableListSidebar>[0]> = {}) {
  return render(
    <TableListSidebar
      tables={makeTables(50)}
      redisKeys={[]}
      loading={false}
      error={null}
      isRedis={false}
      filter=""
      onFilterChange={noop}
      selectedTable={null}
      selectedKey={null}
      pinnedTableNames={new Set()}
      onSelectTable={noop}
      onSelectKey={noop}
      onRefresh={noop}
      onContextMenu={noop}
      {...props}
    />,
  );
}

describe("TableListSidebar — footer count", () => {
  it("reports the plain total when no filter is active", () => {
    renderSidebar();
    const footer = screen.getByTestId("db-table-list-count");
    expect(footer.textContent).toContain("50");
    expect(footer.textContent).not.toContain("3");
  });

  it("reports matched-of-total once a non-empty filter narrows the list", () => {
    renderSidebar({ filter: "users" });
    const footer = screen.getByTestId("db-table-list-count");
    // 3 of the 50 rows match "users" — and the list really renders 3.
    expect(screen.getAllByText(/^users_\d$/)).toHaveLength(3);
    expect(footer.textContent).toContain("3");
    expect(footer.textContent).toContain("50");
  });

  it("does the same for Redis keys", () => {
    const keys = [
      { key: "session:1" }, { key: "session:2" }, { key: "cache:1" }, { key: "cache:2" },
    ] as RedisKeyInfo[];
    renderSidebar({ tables: [], redisKeys: keys, isRedis: true, filter: "session" });
    const footer = screen.getByTestId("db-table-list-count");
    expect(footer.textContent).toContain("2");
    expect(footer.textContent).toContain("4");
  });
});
