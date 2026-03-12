import { describe, it, expect, beforeEach } from "vitest";
import { usePersonaStore } from "../personaStore";
import { mockInvokeMap, resetInvokeMocks, mockInvokeError } from "@/test/tauriMock";
import type { DbSchemaTable, DbSavedQuery, QueryResult } from "@/api/vault/database/dbSchema";

// -- Fixtures --

function makeTable(overrides: Partial<DbSchemaTable> = {}): DbSchemaTable {
  return {
    id: "tbl-1",
    credential_id: "cred-1",
    table_name: "users",
    display_label: null,
    column_hints: null,
    is_favorite: false,
    sort_order: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeQuery(overrides: Partial<DbSavedQuery> = {}): DbSavedQuery {
  return {
    id: "q-1",
    credential_id: "cred-1",
    title: "List users",
    query_text: "SELECT * FROM users",
    language: "sql",
    last_run_at: null,
    last_run_ok: null,
    last_run_ms: null,
    is_favorite: false,
    sort_order: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const emptyQueryResult: QueryResult = {
  columns: ["id", "name"],
  rows: [[1, "alice"]],
  row_count: 1,
  duration_ms: 42,
  truncated: false,
};

// -- Tests --

describe("databaseSlice", () => {
  beforeEach(() => {
    usePersonaStore.setState({
      dbSchemaTables: [],
      dbSavedQueries: [],
    });
    resetInvokeMocks();
  });

  describe("initial state", () => {
    it("has empty tables and queries", () => {
      const state = usePersonaStore.getState();
      expect(state.dbSchemaTables).toEqual([]);
      expect(state.dbSavedQueries).toEqual([]);
    });
  });

  describe("schema tables", () => {
    it("fetchDbSchemaTables populates store", async () => {
      const tables = [makeTable(), makeTable({ id: "tbl-2", table_name: "orders" })];
      mockInvokeMap({ list_db_schema_tables: tables });

      await usePersonaStore.getState().fetchDbSchemaTables("cred-1");

      expect(usePersonaStore.getState().dbSchemaTables).toHaveLength(2);
      expect(usePersonaStore.getState().dbSchemaTables[0]?.table_name).toBe("users");
    });

    it("createDbSchemaTable appends to store", async () => {
      const newTable = makeTable({ id: "tbl-new", table_name: "products" });
      mockInvokeMap({ create_db_schema_table: newTable });

      const result = await usePersonaStore.getState().createDbSchemaTable("cred-1", "products");

      expect(result).toBeDefined();
      expect(result!.id).toBe("tbl-new");
      expect(usePersonaStore.getState().dbSchemaTables).toHaveLength(1);
    });

    it("updateDbSchemaTable replaces in store", async () => {
      usePersonaStore.setState({
        dbSchemaTables: [makeTable()],
      });

      const updated = makeTable({ display_label: "User Accounts" });
      mockInvokeMap({ update_db_schema_table: updated });

      await usePersonaStore.getState().updateDbSchemaTable("tbl-1", { displayLabel: "User Accounts" });

      expect(usePersonaStore.getState().dbSchemaTables[0]?.display_label).toBe("User Accounts");
    });

    it("deleteDbSchemaTable removes from store", async () => {
      usePersonaStore.setState({
        dbSchemaTables: [makeTable(), makeTable({ id: "tbl-2" })],
      });
      mockInvokeMap({ delete_db_schema_table: true });

      await usePersonaStore.getState().deleteDbSchemaTable("tbl-1");

      expect(usePersonaStore.getState().dbSchemaTables).toHaveLength(1);
      expect(usePersonaStore.getState().dbSchemaTables[0]?.id).toBe("tbl-2");
    });
  });

  describe("saved queries", () => {
    it("fetchDbSavedQueries populates store", async () => {
      const queries = [makeQuery(), makeQuery({ id: "q-2", title: "Count" })];
      mockInvokeMap({ list_db_saved_queries: queries });

      await usePersonaStore.getState().fetchDbSavedQueries("cred-1");

      expect(usePersonaStore.getState().dbSavedQueries).toHaveLength(2);
    });

    it("createDbSavedQuery appends to store", async () => {
      const newQuery = makeQuery({ id: "q-new", title: "New Q" });
      mockInvokeMap({ create_db_saved_query: newQuery });

      const result = await usePersonaStore.getState().createDbSavedQuery("cred-1", "New Q", "SELECT 1");

      expect(result).toBeDefined();
      expect(result!.title).toBe("New Q");
      expect(usePersonaStore.getState().dbSavedQueries).toHaveLength(1);
    });

    it("updateDbSavedQuery replaces in store", async () => {
      usePersonaStore.setState({
        dbSavedQueries: [makeQuery()],
      });

      const updated = makeQuery({ title: "Updated Title" });
      mockInvokeMap({ update_db_saved_query: updated });

      await usePersonaStore.getState().updateDbSavedQuery("q-1", { title: "Updated Title" });

      expect(usePersonaStore.getState().dbSavedQueries[0]?.title).toBe("Updated Title");
    });

    it("deleteDbSavedQuery removes from store", async () => {
      usePersonaStore.setState({
        dbSavedQueries: [makeQuery(), makeQuery({ id: "q-2" })],
      });
      mockInvokeMap({ delete_db_saved_query: true });

      await usePersonaStore.getState().deleteDbSavedQuery("q-1");

      expect(usePersonaStore.getState().dbSavedQueries).toHaveLength(1);
      expect(usePersonaStore.getState().dbSavedQueries[0]?.id).toBe("q-2");
    });
  });

  describe("query execution", () => {
    it("executeDbQuery returns result", async () => {
      mockInvokeMap({ execute_db_query: emptyQueryResult });

      const result = await usePersonaStore.getState().executeDbQuery("cred-1", "SELECT 1");

      expect(result.columns).toEqual(["id", "name"]);
      expect(result.row_count).toBe(1);
      expect(result.duration_ms).toBe(42);
    });

    it("executeDbQuery throws on error", async () => {
      mockInvokeError("execute_db_query", "Query syntax error");

      await expect(
        usePersonaStore.getState().executeDbQuery("cred-1", "INVALID SQL"),
      ).rejects.toThrow("Query syntax error");
    });
  });
});
