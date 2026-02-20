import { invoke } from "@tauri-apps/api/core";

import type { ConnectorDefinition } from "@/lib/bindings/ConnectorDefinition";
import type { CreateConnectorDefinitionInput } from "@/lib/bindings/CreateConnectorDefinitionInput";
import type { UpdateConnectorDefinitionInput } from "@/lib/bindings/UpdateConnectorDefinitionInput";

// ============================================================================
// Connectors
// ============================================================================

export const listConnectors = () =>
  invoke<ConnectorDefinition[]>("list_connectors");

export const getConnector = (id: string) =>
  invoke<ConnectorDefinition>("get_connector", { id });

export const createConnector = (input: CreateConnectorDefinitionInput) =>
  invoke<ConnectorDefinition>("create_connector", { input });

export const updateConnector = (
  id: string,
  input: UpdateConnectorDefinitionInput,
) => invoke<ConnectorDefinition>("update_connector", { id, input });

export const deleteConnector = (id: string) =>
  invoke<boolean>("delete_connector", { id });
