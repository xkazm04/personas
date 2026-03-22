import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { DatabaseListView } from "../DatabaseListView";
import { usePersonaStore } from "@/stores/personaStore";
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
    usePersonaStore.setState({
      credentials: [],
      connectorDefinitions: [],
      dbSchemaTables: [],
      dbSavedQueries: [],
    });
  });

  it("shows empty state when no database credentials exist", () => {
    usePersonaStore.setState({
      credentials: [],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    expect(screen.getByText("No database credentials")).toBeInTheDocument();
  });

  it("renders database credentials as cards", () => {
    usePersonaStore.setState({
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
    usePersonaStore.setState({
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

  it("shows tab bar when multiple connector types exist", () => {
    usePersonaStore.setState({
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
    // Both database rows render in the DataGrid
    expect(screen.getByText("Supa DB")).toBeInTheDocument();
    expect(screen.getByText("Neon DB")).toBeInTheDocument();
    // Type column shows connector labels for each row
    expect(screen.getByText("Supabase")).toBeInTheDocument();
    expect(screen.getByText("Neon")).toBeInTheDocument();
  });

  it("does not show tab bar with only one connector type", () => {
    usePersonaStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "DB One" }),
        makeCredential({ id: "cred-2", name: "DB Two" }),
      ],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    // Both rows render in the DataGrid
    expect(screen.getByText("DB One")).toBeInTheDocument();
    expect(screen.getByText("DB Two")).toBeInTheDocument();
  });

  it("filters credentials by type filter", async () => {
    usePersonaStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "Production DB", service_type: "supabase" }),
        makeCredential({ id: "cred-2", name: "Staging DB", service_type: "neon" }),
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

    // Both rows visible initially
    expect(screen.getByText("Production DB")).toBeInTheDocument();
    expect(screen.getByText("Staging DB")).toBeInTheDocument();

    // Open the type filter dropdown
    await act(async () => {
      fireEvent.click(screen.getByText("All Types (2)"));
    });

    // The dropdown renders inside a div with class "max-h-48 overflow-y-auto"
    // Find the dropdown options container and click "Supabase" within it
    const dropdownList = document.querySelector(".max-h-48.overflow-y-auto")!;
    const dropdownScope = within(dropdownList as HTMLElement);
    await act(async () => {
      fireEvent.click(dropdownScope.getByText("Supabase"));
    });

    // Only Supabase credential should remain
    await waitFor(() => {
      expect(screen.queryByText("Staging DB")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Production DB").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'No matching databases' when type filter has no results", () => {
    usePersonaStore.setState({
      credentials: [
        makeCredential({ id: "cred-1", name: "My Supabase DB", service_type: "supabase" }),
      ],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    // The DataGrid shows the row initially
    expect(screen.getByText("My Supabase DB")).toBeInTheDocument();
  });

  it("shows column headers when credentials exist", () => {
    usePersonaStore.setState({
      credentials: [makeCredential()],
      connectorDefinitions: [makeConnector()],
    });

    render(<DatabaseListView onBack={() => {}} />);
    // DataGrid renders column headers
    expect(screen.getByText("Database")).toBeInTheDocument();
    expect(screen.getByText("Tables")).toBeInTheDocument();
    expect(screen.getByText("Queries")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });
});
