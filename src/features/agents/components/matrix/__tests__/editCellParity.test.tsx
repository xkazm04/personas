/**
 * Edit cell parity tests -- proves all 7 edit cell components render without errors.
 *
 * INTG-02: All edit cells from the matrix are accessible and functional.
 * MTRX-08: All 7 edit cell capabilities are preserved and tested.
 *
 * These tests verify that each edit cell mounts with minimal props and renders
 * its key interactive element. Detailed interaction testing is not needed since
 * the components themselves are unchanged -- the goal is automated proof that
 * they remain importable and renderable after the mode retirement.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock heavy dependencies to isolate cell rendering
// ---------------------------------------------------------------------------

// Mock ThemedSelect (used by Review, Memory, Messages, Error cells)
vi.mock("@/features/shared/components/forms/ThemedSelect", () => ({
  ThemedSelect: ({
    value,
    _placeholder,
    options,
  }: {
    value?: string;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
  }) => (
    <select data-testid="themed-select" defaultValue={value}>
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

// Mock ConnectorIcon and getConnectorMeta (used by ConnectorEditCell)
vi.mock("@/features/shared/components/display/ConnectorMeta", () => ({
  ConnectorIcon: ({ name }: { name: string }) => (
    <span data-testid={`connector-icon-${name}`}>{name}</span>
  ),
  getConnectorMeta: (name: string) => ({
    displayName: name,
    category: "general",
    icon: null,
  }),
}));

// Mock Button component
vi.mock("@/features/shared/components/buttons", () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode;
  }) => (
    <button onClick={onClick} data-testid="mock-button" {...rest}>
      {children}
    </button>
  ),
}));

// Mock useClickOutside hook
vi.mock("@/hooks/utility/interaction/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}));

// Mock connectorRoles
vi.mock("@/lib/credentials/connectorRoles", () => ({
  getRoleForConnector: () => "general",
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => {
  const Icon = ({ className }: { className?: string }) => (
    <span className={className} data-testid="lucide-icon" />
  );
  return {
    CheckCircle2: Icon,
    X: Icon,
    Database: Icon,
    Plus: Icon,
    Table2: Icon,
    MessageSquare: Icon,
    AlertCircle: Icon,
    Pencil: Icon,
    Clock: Icon,
    Webhook: Icon,
    MousePointerClick: Icon,
    Radio: Icon,
    Activity: Icon,
  };
});

// ---------------------------------------------------------------------------
// Import cell components under test
// ---------------------------------------------------------------------------

import {
  ConnectorEditCell,
  TriggerEditCell,
  ReviewEditCell,
  MemoryEditCell,
  MessagesEditCell,
  ErrorEditCell,
  UseCaseEditCell,
} from "@/features/templates/sub_generated/gallery/matrix/EditableMatrixCells";
import type {
  MatrixEditState,
  MatrixEditCallbacks,
} from "@/features/templates/sub_generated/gallery/matrix/EditableMatrixCells";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function createMinimalEditState(): MatrixEditState {
  return {
    connectorCredentialMap: {},
    connectorSwaps: {},
    triggerConfigs: {},
    requireApproval: false,
    autoApproveSeverity: "",
    reviewTimeout: "24h",
    memoryEnabled: false,
    memoryScope: "",
    messagePreset: "critical",
    errorStrategy: "halt",
    useCases: [
      { id: "uc1", title: "Test Use Case", category: "automation" },
    ],
  };
}

function createMinimalCallbacks(): MatrixEditCallbacks {
  return {
    onCredentialSelect: vi.fn(),
    onConnectorSwap: vi.fn(),
    onTriggerConfigChange: vi.fn(),
    onToggleApproval: vi.fn(),
    onToggleMemory: vi.fn(),
    onPreferenceChange: vi.fn(),
    onErrorStrategyChange: vi.fn(),
    onUseCaseAdd: vi.fn(),
    onUseCaseRemove: vi.fn(),
    onUseCaseUpdate: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Edit cell parity -- all 7 cells render (INTG-02, MTRX-08)", () => {
  const editState = createMinimalEditState();
  const callbacks = createMinimalCallbacks();

  it("ConnectorEditCell renders with required props", () => {
    const { container } = render(
      <ConnectorEditCell
        requiredConnectors={[
          {
            name: "github",
            service_type: "github",
            required: true,
            description: "GitHub API",
            connected: false,
            matched_credentials: [],
          },
        ]}
        credentials={[]}
        editState={editState}
        callbacks={callbacks}
      />,
    );
    // Should render without throwing
    expect(container.firstChild).toBeTruthy();
  });

  it("TriggerEditCell renders with required props", () => {
    const { container } = render(
      <TriggerEditCell
        designResult={{
          suggested_triggers: [
            {
              trigger_type: "schedule",
              description: "Every hour",
              config: { cron: "0 * * * *" },
            },
          ],
        } as unknown}
        editState={editState}
        callbacks={callbacks}
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("ReviewEditCell renders ThemedSelect for review policy", () => {
    render(
      <ReviewEditCell editState={editState} callbacks={callbacks} />,
    );
    const select = screen.getByTestId("themed-select");
    expect(select).toBeTruthy();
  });

  it("MemoryEditCell renders ThemedSelect for memory toggle", () => {
    render(
      <MemoryEditCell editState={editState} callbacks={callbacks} />,
    );
    const select = screen.getByTestId("themed-select");
    expect(select).toBeTruthy();
  });

  it("MessagesEditCell renders ThemedSelect for message preset", () => {
    render(
      <MessagesEditCell editState={editState} callbacks={callbacks} />,
    );
    const select = screen.getByTestId("themed-select");
    expect(select).toBeTruthy();
  });

  it("ErrorEditCell renders ThemedSelect for error strategy", () => {
    render(
      <ErrorEditCell editState={editState} callbacks={callbacks} />,
    );
    const select = screen.getByTestId("themed-select");
    expect(select).toBeTruthy();
  });

  it("UseCaseEditCell renders use case list with add/remove", () => {
    const { container } = render(
      <UseCaseEditCell editState={editState} callbacks={callbacks} />,
    );
    expect(container.firstChild).toBeTruthy();
    // Should show the existing use case title
    expect(container.textContent).toContain("Test Use Case");
  });
});
