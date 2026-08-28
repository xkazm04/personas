import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TableListSidebar } from "../TableListSidebar";
import { ColumnList } from "../ColumnList";
import { AssistantSqlBlock } from "../AssistantSqlBlock";
import type { ChatMessage } from "../ChatMessages";

/**
 * Three surfaces in this feature hand-painted their own `bg-red-500/10` div —
 * no icon, no role="alert", no retry — while the console and results panes two
 * surfaces over already rendered the shared InlineErrorBanner. These pin that
 * all of them now announce as alerts.
 */
const noop = () => {};

describe("sub_databases error surfaces use the shared banner", () => {
  it("the schema sidebar announces an introspection failure as an alert", () => {
    render(
      <TableListSidebar
        tables={[]}
        redisKeys={[]}
        loading={false}
        error="could not connect to host"
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
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("could not connect to host");
  });

  it("the column list announces a column-introspection failure as an alert", () => {
    render(
      <ColumnList
        columns={[]}
        columnsLoading={false}
        columnsError="permission denied for relation users"
        isApi={false}
        columnLabel="Column"
        typeLabel="Type"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("permission denied for relation users");
  });

  it("a failed chat execution announces as an alert and keeps its line breaks", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      sql: "SELECT 1",
      error: "ERROR: syntax error\nLINE 1: SELEC 1",
      status: "done",
    };
    render(
      <AssistantSqlBlock
        msg={msg}
        language="sql"
        copiedSql={null}
        onCopySql={noop}
        onEditSql={noop}
        onExecuteSql={noop}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("LINE 1: SELEC 1");
    // white-space inherits, so the multi-line engine error stays readable.
    expect(alert.className).toContain("whitespace-pre-wrap");
  });
});
