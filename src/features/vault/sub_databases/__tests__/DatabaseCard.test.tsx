import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatabaseCard } from "../DatabaseCard";
import type { CredentialMetadata, ConnectorDefinition } from "@/lib/types/types";

function makeCredential(overrides: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return {
    id: "cred-1",
    name: "My Supabase DB",
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
    icon_url: "https://example.com/supabase.svg",
    fields: [],
    healthcheck_config: null,
    services: [],
    events: [],
    metadata: null,
    ...overrides,
  } as ConnectorDefinition;
}

describe("DatabaseCard", () => {
  it("renders credential name", () => {
    render(
      <DatabaseCard
        credential={makeCredential()}
        connector={makeConnector()}
        tableCount={0}
        queryCount={0}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("My Supabase DB")).toBeInTheDocument();
  });

  it("renders connector label", () => {
    render(
      <DatabaseCard
        credential={makeCredential()}
        connector={makeConnector()}
        tableCount={0}
        queryCount={0}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("Supabase")).toBeInTheDocument();
  });

  it("falls back to service_type when no connector", () => {
    render(
      <DatabaseCard
        credential={makeCredential()}
        connector={undefined}
        tableCount={0}
        queryCount={0}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("supabase")).toBeInTheDocument();
  });

  it("renders table count badge when > 0", () => {
    render(
      <DatabaseCard
        credential={makeCredential()}
        connector={makeConnector()}
        tableCount={5}
        queryCount={0}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders query count badge when > 0", () => {
    render(
      <DatabaseCard
        credential={makeCredential()}
        connector={makeConnector()}
        tableCount={0}
        queryCount={3}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides badges when counts are 0", () => {
    const { container } = render(
      <DatabaseCard
        credential={makeCredential()}
        connector={makeConnector()}
        tableCount={0}
        queryCount={0}
        onClick={() => {}}
      />,
    );
    // No badge spans should be present
    const badges = container.querySelectorAll(".inline-flex");
    expect(badges.length).toBe(0);
  });

  it("fires onClick when clicked", () => {
    const handleClick = vi.fn();
    render(
      <DatabaseCard
        credential={makeCredential()}
        connector={makeConnector()}
        tableCount={0}
        queryCount={0}
        onClick={handleClick}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
