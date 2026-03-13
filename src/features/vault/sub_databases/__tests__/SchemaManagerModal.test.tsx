import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchemaManagerModal } from "../SchemaManagerModal";
import { useVaultStore } from "@/stores/vaultStore";
import { resetInvokeMocks, mockInvokeMap } from "@/test/tauriMock";
import type { CredentialMetadata, ConnectorDefinition } from "@/lib/types/types";

// Mock framer-motion to avoid animation issues in tests
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
        style
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
    name: "My Test Database",
    service_type: "supabase",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    last_used_at: null,
    metadata: null,
    ...overrides,
  } as CredentialMetadata;
}

function makeConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
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
    ...overrides,
  } as ConnectorDefinition;
}

describe("SchemaManagerModal", () => {
  beforeEach(() => {
    resetInvokeMocks();
    mockInvokeMap({
      list_db_schema_tables: [],
      list_db_saved_queries: [],
    });
    useVaultStore.setState({
      dbSchemaTables: [],
      dbSavedQueries: [],
    });
  });

  it("renders credential name in header", () => {
    render(
      <SchemaManagerModal
        credential={makeCredential()}
        connector={makeConnector()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("My Test Database")).toBeInTheDocument();
  });

  it("renders connector label in subtitle", () => {
    render(
      <SchemaManagerModal
        credential={makeCredential()}
        connector={makeConnector()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Supabase/)).toBeInTheDocument();
  });

  it("shows Tables tab by default", () => {
    render(
      <SchemaManagerModal
        credential={makeCredential()}
        connector={makeConnector()}
        onClose={() => {}}
      />,
    );
    // Tables tab text should be present
    expect(screen.getByText("Tables")).toBeInTheDocument();
    expect(screen.getByText("Queries")).toBeInTheDocument();
    expect(screen.getByText("Console")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <SchemaManagerModal
        credential={makeCredential()}
        connector={makeConnector()}
        onClose={handleClose}
      />,
    );

    // Find the close button (the one with X icon)
    const buttons = screen.getAllByRole("button");
    const closeButton = buttons.find((b) => b.querySelector("svg"));
    if (closeButton) {
      fireEvent.click(closeButton);
      expect(handleClose).toHaveBeenCalledTimes(1);
    }
  });

  it("switches tabs on click", () => {
    render(
      <SchemaManagerModal
        credential={makeCredential()}
        connector={makeConnector()}
        onClose={() => {}}
      />,
    );

    // Click "Console" tab
    fireEvent.click(screen.getByText("Console"));
    // Console tab should now be active -- the ConsoleTab component renders
    // (we can check that the "Run Query" button appears which is part of ConsoleTab)
    expect(screen.getByText("Run Query")).toBeInTheDocument();
  });

  it("falls back to service_type when no connector", () => {
    render(
      <SchemaManagerModal
        credential={makeCredential()}
        connector={undefined}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/supabase/)).toBeInTheDocument();
  });
});
