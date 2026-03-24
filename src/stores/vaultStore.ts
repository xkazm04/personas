/**
 * Vault domain store -- credentials, databases, automations, and rotation.
 */
import { create } from "zustand";
import type { VaultStore } from "./storeTypes";

import { createCredentialSlice } from "./slices/vault/credentialSlice";
import { createDatabaseSlice } from "./slices/vault/databaseSlice";
import { createAutomationSlice } from "./slices/vault/automationSlice";
import { createRotationSlice } from "./slices/vault/rotationSlice";

export const useVaultStore = create<VaultStore>()((...a) => ({
  error: null,
  errorKind: null,
  isLoading: false,
  ...createCredentialSlice(...a),
  ...createDatabaseSlice(...a),
  ...createAutomationSlice(...a),
  ...createRotationSlice(...a),
}));
