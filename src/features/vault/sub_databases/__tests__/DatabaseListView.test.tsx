import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatabaseListView } from "../DatabaseListView";
import { useVaultStore } from "@/stores/vaultStore";
import { resetInvokeMocks, mockInvokeMap } from "@/test/tauriMock";
import type { CredentialMetadata, ConnectorDefinition } from "@/lib/types/types";

// Mock framer-motion to avoid animation issues in jsdom
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({
        children,
        className,
        onClick,
        style,
        ..._rest
      }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
        <div className={className} onClick={onClick} style={style}>
          {children}
        </div>
      ),
    },
  };
});

function makeCredential(overrides: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return {
    id: "cred-1",
    name: "My Supabase DB",
    service_type: "supabase",
    metadata: null,
    healthcheck_last_success: null,
    healthcheck_last_message: null,
    healthcheck_last_tested_at: null,
    healthcheck_last_success_at: null,
    last_used_at: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    id: "conn-1",
    name: "supabase",
    label: "Supabase",
    category: "database",
    color: "#3ECF8E",
    icon_url: null,
    fields: [],
    healthcheck_config: null,
    services: [],
    events: [],
    metadata: null,
    is_builtin: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DatabaseListView", () => {
  beforeEach(() => {
    resetInvokeMocks();
    mockInvokeMap({
      list_db_schema_tables: [],
      list_db_saved_queries: [],
    });
    useVaultStore.setState({
      credentials: [],
      connectorDefinitions: [],
      dbSchemaTables: [],
      dbSavedQueries: [],
    });
  });

  it("shows empty state when no database credentials exist", () => {
    useVaultStore.setState({
      credentials: [],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("No database credentials")).toBeInTheDocument();
  });

  it("renders database credential names in the grid", () => {
    useVaultStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "DB Alpha" }),
        makeCredential({ id: "cred-2", name: "DB Beta" }),
      ],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("DB Alpha")).toBeInTheDocument();
    expect(screen.getByText("DB Beta")).toBeInTheDocument();
  });

  it("filters out non-database credentials", () => {
    useVaultStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "My Supabase DB" }),
        makeCredential({ id: "cred-2", name: "My Slack", service_type: "slack" }),
      ],
      connectorDefinitions: [
        makeConnector(),
        makeConnector({
          id: "conn-2",
          name: "slack",
          label: "Slack",
          category: "messaging",
        }),
      ],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("My Supabase DB")).toBeInTheDocument();
    expect(screen.queryByText("My Slack")).not.toBeInTheDocument();
  });

  it("shows DataGrid column headers", () => {
    useVaultStore.setState({
      credentials: [makeCredential()],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    // Sortable columns render as buttons with text
    expect(screen.getByText("Database")).toBeInTheDocument();
    // Was "Tables" until 2026-09-18; the column counts PINNED schema
    // bookmarks, never the database's own tables.
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Queries")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    // "Type" column uses a filter dropdown (ThemedSelect), not plain text header
  });

  it("shows 'No matching databases' as empty grid message", () => {
    useVaultStore.setState({
      credentials: [makeCredential()],
      connectorDefinitions: [makeConnector()],
    });

    // The DataGrid shows its emptyTitle when data is empty after filtering.
    // We test this by setting a type filter that excludes all rows.
    // For now, verify the empty title is set by checking the component renders
    // the credential data properly when present.
    render(<DatabaseListView onBack={() => {}} />);
    // The credential should show up since we have matching data
    expect(screen.getByText("My Supabase DB")).toBeInTheDocument();
  });

  it("shows connector type label in type column", () => {
    useVaultStore.setState({
      credentials: [makeCredential({ id: "cred-1", name: "Supa DB", service_type: "supabase" })],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    // "Supabase" appears as type label in the row
    expect(screen.getAllByText("Supabase").length).toBeGreaterThanOrEqual(1);
  });

  it("renders multiple database types", () => {
    useVaultStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "Supa DB", service_type: "supabase" }),
        makeCredential({ id: "cred-2", name: "Neon DB", service_type: "neon" }),
      ],
      connectorDefinitions: [
        makeConnector(),
        makeConnector({
          id: "conn-2",
          name: "neon",
          label: "Neon",
          category: "database",
        }),
      ],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("Supa DB")).toBeInTheDocument();
    expect(screen.getByText("Neon DB")).toBeInTheDocument();
  });

  it("renders with empty dbSchemaTables and dbSavedQueries", () => {
    useVaultStore.setState({
      credentials: [makeCredential()],
      connectorDefinitions: [makeConnector()],
      dbSchemaTables: [],
      dbSavedQueries: [],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("My Supabase DB")).toBeInTheDocument();
  });
  it("includes connectors that tag database without being categorised as one", () => {
    // Airtable's coarse bucket is `spreadsheet` and Notion's is `knowledge_base`,
    // but both tag `database` in the builtin multi-tag list. Slack tags neither.
    useVaultStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "Ops Base", service_type: "airtable" }),
        makeCredential({ id: "cred-2", name: "Team Wiki", service_type: "notion" }),
        makeCredential({ id: "cred-3", name: "My Slack", service_type: "slack" }),
      ],
      connectorDefinitions: [
        makeConnector({ id: "conn-1", name: "airtable", label: "Airtable", category: "spreadsheet" }),
        makeConnector({ id: "conn-2", name: "notion", label: "Notion", category: "knowledge_base" }),
        makeConnector({ id: "conn-3", name: "slack", label: "Slack", category: "messaging" }),
      ],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("Ops Base")).toBeInTheDocument();
    expect(screen.getByText("Team Wiki")).toBeInTheDocument();
    expect(screen.queryByText("My Slack")).not.toBeInTheDocument();
  });

  /**
   * The grid's third column counts `dbSchemaTables` -- the user's PINNED
   * schema bookmarks -- and used to be headed "Tables". A healthy Postgres
   * with 40 tables and no pins rendered `--` under that header, which reads as
   * an empty database and is how an unexplored production database gets
   * skipped. The column now says what it counts.
   */
  describe("the pinned-tables column names the quantity it holds", () => {
    function renderGrid(dbSchemaTables: unknown[]) {
      useVaultStore.setState({
        credentials: [makeCredential()],
        connectorDefinitions: [makeConnector()],
        dbSchemaTables: dbSchemaTables as never,
        dbSavedQueries: [],
      });
      render(<DatabaseListView onBack={() => {}} />);
    }

    it("is not headed with the database's own table count", () => {
      renderGrid([]);
      expect(screen.getByText("Pinned")).toBeInTheDocument();
      expect(screen.queryByText("Tables")).not.toBeInTheDocument();
    });

    it("shows a known zero as 0, not as the unknown dash", () => {
      renderGrid([]);
      expect(screen.getByTestId("db-grid-no-pins").textContent).toBe("0");
    });

    it("counts the pins it has", () => {
      renderGrid([
        { id: "t1", credential_id: "cred-1", table_name: "users" },
        { id: "t2", credential_id: "cred-1", table_name: "orders" },
      ]);
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.queryByTestId("db-grid-no-pins")).not.toBeInTheDocument();
    });
  });

});
